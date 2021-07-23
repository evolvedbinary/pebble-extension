import { injectable, inject } from "inversify";
import { v4 } from "uuid";
import { FSNode, FSDocumentNode, FSCollectionNode, FSToolbarNode, FSConnectionNode, FSItemNode, FSSecurityNode, FSUsersNode, FSGroupsNode, FSUserNode, FSGroupNode, FSContainerNode, FSIndexesNode, FSIndexNode, FSRestNode, FSRestURINode, FSRestMethodNode, FSLoadEvent } from "../classes/node";
import { open, TreeNode, CompositeTreeNode, ConfirmDialog, SingleTextInputDialog, OpenerService, StatusBar, StatusBarAlignment, WidgetManager } from "@theia/core/lib/browser";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { OpenFileDialogProps, FileDialogService } from "@theia/filesystem/lib/browser";
import { FSDocument, FSCollection, FSItem } from "../classes/item";
import { FSServerConnection, FSServerConnections, FSServerConnectionsChangeEvent } from "../classes/connection";
import { CommandRegistry, Event, Emitter } from "@theia/core";
import { actionID } from "../classes/action";
import { FSApi, API_MINIMUM_VERSION } from "../common/api";
import URI from "@theia/core/lib/common/uri";
import { FSDragOperation } from "./widget/drag";
import { FSTemplate } from "../classes/template";
import { FSConnectionDialog, FSNewFromTemplateDialog, FSNewFromTemplateDialogResult, FSPropertiesDialog } from "./dialogs";
import { FSFiles, FSFileList } from "../classes/files";
import { lookup } from "mimetype";
import { createError, FSError, FSErrorObject, ERROR_MESSAGES } from "../classes/error";
import { asyncForEach } from "../common/asyncForEach";
import { FSStatusEntry } from "../classes/status";
import { actProperties } from "./commands";
import { FSTreeModel } from "../classes/tree";
import { FSUserDialog } from "./dialogs/user-dialog";
import { FSGroupDialog } from "./dialogs/group-dialog";
import { FS_EVAL_WIDGET_FACTORY_ID, XQ_EXT } from '../classes/eval';
import { FSLabelProviderContribution } from "./label-provider-contribution";
import { FSDialog } from "./dialogs/basic";
import { FSViewWidget } from "./widget";

export const FS_CONNECTIONS_WIDGET_FACTORY_ID = 'fusion-view';

function sortText(A: string, B: string, caseSensetive = false): number {
  let a = A;
  let b = B;
  if (!caseSensetive) {
    a = a.toLowerCase();
    b = b.toLowerCase();
  }
  return a < b ? -1 : a > b ? 1 : caseSensetive ? 0 : sortText(A, B, true);
}

export const FS_RESOURCE_SCHEME = 'fusion';
const TRAILING_SYMBOL = '/';
const STATUSBAR_ELEMENT = 'fusion-statusbar';
@injectable()
export class FSCore {
  protected statusEntry: FSStatusEntry = { text: '', alignment: StatusBarAlignment.LEFT, command: actionID(actProperties.id) };
  protected clipboard: Partial<FSDragOperation> = {};
  protected lastNameID: number = 1;
  protected _labelProvider?: FSLabelProviderContribution;
  public result: string = '';
  public connectionsChange = new Emitter<FSServerConnectionsChangeEvent>();
  public connections: FSServerConnections = {};
  protected nodesToUpdate: FSNode[] = [];
  constructor(
    @inject(CommandRegistry) protected readonly commands: CommandRegistry,
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService,
    @inject(FileDialogService) protected readonly fileDialog: FileDialogService,
    @inject(FSFiles) protected readonly files: FSFiles,
    @inject(OpenerService) private readonly openerService: OpenerService,
    @inject(StatusBar) protected readonly statusBar: StatusBar,
    @inject(WidgetManager) protected widgetManager: WidgetManager,
  ) {}

  updating = false;
  renaming = '';
  dict: Record<string, FSNode> = {};
  loadEvents: Record<string, (FSLoadEvent)[]> = {};

  setLabelProvider(labelProvider: FSLabelProviderContribution) {
    this._labelProvider = labelProvider;
  }

  async loadState() {
    try {
      const connectionsString = localStorage.getItem('connections');
      if (connectionsString) {
        this.connections = JSON.parse(connectionsString);
        for (let id in this.connections) {
          await this.addConnection(this.connections[id], this.model?.root as CompositeTreeNode);
        }
      }
    } catch {}
  }
  saveState() {
    localStorage.setItem('connections', JSON.stringify(this.connections));
  }

  // tree model
  private _tree?: FSViewWidget;
  public set tree(tree: FSViewWidget | undefined) {
    if (this._tree != tree) {
      this._tree = tree;
      this.createRoot();
      this.loadState();
    }
  }
  public get tree(): FSViewWidget | undefined {
    return this._tree;
  }
  public get model(): FSTreeModel | undefined {
    return this.tree?.model as FSTreeModel;
  }

  // connections list

  get onConnectionsChange(): Event<FSServerConnectionsChangeEvent> {
    return this.connectionsChange.event;
  }

  protected connectionAdded(connectionNode: FSConnectionNode) {
    this.connectionsChange.fire({ id: connectionNode.nodeId, action: 'add' })
    this.connections[connectionNode.nodeId] = connectionNode.connection;
    this.saveState();
  }

  protected connectionDeleted(connectionNode: FSConnectionNode) {
    this.connectionsChange.fire({ id: connectionNode.nodeId, action: 'delete' })
    delete(this.connections[connectionNode.nodeId]);
    this.saveState();
  }

  // nodes:

  protected sortItems(a: FSNode, b: FSNode): number {
    if (FSNode.isItem(a) && FSNode.isItem(b)) {
      if (a.isCollection === b.isCollection) {
        return sortText(a.nodeName, b.nodeName);
      } else {
        return a.isCollection ? -1 : 1;
      }
    } else {
      return FSNode.isItem(a) ? 1 : FSNode.isItem(b) ? -1 : sortText(a.nodeName, b.nodeName);
    }
  }

  protected sortRest(a: FSNode, b: FSNode): number {
    return sortText(a.nodeName, b.nodeName);
  }

  protected async sort(node: CompositeTreeNode, sortfunc: (a: FSNode, b: FSNode) => number) {
    if (this.model) {
      if (FSNode.isContainer(node)) {
        node.children = (node.children as FSNode[]).sort(sortfunc);
      }
      await this.model.refresh(node);
    }
  }

  protected createRoot() {
    if (this.model) {
      this.model.root = {
        id: 'fusion-connections-view-root',
        visible: false,
        children: [],
        nodeName: 'root',
        parent: undefined
      } as CompositeTreeNode;
      this.addToolbar(this.model.root as CompositeTreeNode);
    }
  }

  protected async addNode(child: FSNode, parent: CompositeTreeNode): Promise<FSNode> {
    if (this.dict[child.nodeId]) {
      throw 'node already exists';
    }
    CompositeTreeNode.addChild(parent, child);
    if (FSNode.isCollection(parent)) {
      await this.sort(parent, this.sortItems);
    } else {
      if (this.model) {
        await this.model.refresh();
      }
    }
    if (child.nodeId !== 'fusion-toolbar') {
      this.addNodesToUpdate(child);
    }
    this.dict[child.nodeId] = this.getNode(child.id) as FSNode;
    return this.dict[child.nodeId];
  }

  protected addToolbar(parent: CompositeTreeNode): void {
    this.addNode({
      type: 'toolbar',
      id: v4(),
      nodeId: 'fusion-toolbar',
      uri: 'toolbar',
      nodeName: 'toolbar',
      parent: parent,
      selected: false,
      connectionNode: undefined as any,
    } as FSToolbarNode, parent);
  }

  protected removeNode(child: FSNode) {
    if (this.loadEvents[child.id]) {
      delete(this.loadEvents[child.id]);
    }
    const removeNodeId = (node: FSNode) => {
      delete(this.dict[node.nodeId]);
      if (CompositeTreeNode.is(node)) {
        node.children.forEach(childNode => {
          if (FSNode.is(childNode)) {
            removeNodeId(childNode);
          }
        });
      }
    };
    const parent = FSNode.isCollection(child.parent) ? child.parent : undefined;
    removeNodeId(child);
    this.model && this.model.removeNode(child);
    return this.updating ? Promise.resolve(undefined) : this.refresh(parent);
  }

  public get selectedCount(): number {
    return this.model ? this.model.selectedNodes.length : 0;
  }

  public get node(): FSNode | undefined {
    if (this.model && this.model.selectedNodes.length > 0) {
      return this.model.selectedNodes[0] as any as FSNode;
    }
  }

  public get selection(): FSItemNode[] {
    return this.model ? this.model.selectedNodes as any : [];
  }

  public select(node: FSItemNode | FSConnectionNode | FSRestMethodNode | FSUserNode | FSGroupNode) {
    if (!FSNode.isToolbar(node)) {
      this.model && this.model.selectNode(node);
    }
  }

  protected async empty(node: CompositeTreeNode) {
    while (node.children.length) {
      this.removeNode(node.children[node.children.length - 1] as FSNode);
    }
  }
  
  public expanded(node: FSContainerNode) {
    if (node.loaded) {
      if (FSNode.isCollection(node)) {
        this.asyncLoad(node);
      } else if (FSNode.isUsers(node)) {
        this.refreshUsers(node.connectionNode.security);
      } else if (FSNode.isGroups(node)) {
        this.refreshGroups(node.connectionNode.security);
      } else if (FSNode.isIndexes(node)) {
        this.refreshIndexes(node.connectionNode);
      }
    } else {
      if (FSNode.isConnection(node)) {
        this.connect(node);
      } else if (FSNode.isCollection(node)) {
        this.load(node, node.uri);
      }
    }
  }

  public async expand(node: CompositeTreeNode) {
    this.model && await this.model.expandNode(node as any);
  }

  public expandAndWait(node: FSContainerNode) {
    return new Promise(resolve => {
      this.addLoadEvent(node, node => {
        resolve(null);
        return true;
      });
      this.expand(node);
    })
  }

  public async ensureExpanded(node: FSContainerNode) {
    if (!node.expanded && !node.loaded) {
      await this.expandAndWait(node);
    }
  }

  public getNode(id: string): FSNode | undefined {
    return this.dict[id] || (this.model ? this.model.getNode(id) as FSNode : undefined);
    // return this.model ? this.model.getNode(id) as FSNode : undefined;
  }

  // Fusion nodes detection

  public get isSelected(): boolean {
    return !!this.model && this.model.selectedNodes.length > 0;
  }

  public get isNew(): boolean {
    return FSNode.isDocument(this.node) && !!this.node.isNew;
  }

  public get isItem(): boolean {
    return this.isSelected && FSNode.isItem(this.node);
  }

  public get isConnection(): boolean {
    return this.isSelected && FSNode.isConnection(this.node);
  }

  public get isCollection(): boolean {
    return this.isSelected && FSNode.isCollection(this.node);
  }

  public get isDocument(): boolean {
    return this.isSelected && FSNode.isDocument(this.node);
  }

  public get isLoading(): boolean {
    return this.isSelected && !!this.node && !!this.node.loading;
  }

  public get isSecurity(): boolean {
    return this.isSelected && FSNode.isSecurity(this.node);
  }
  public get isUsers(): boolean {
    return this.isSelected && FSNode.isUsers(this.node);
  }

  public get isUser(): boolean {
    return this.isSelected && FSNode.isUser(this.node);
  }

  public get isGroups(): boolean {
    return this.isSelected && FSNode.isGroups(this.node);
  }

  public get isGroup(): boolean {
    return this.isSelected && FSNode.isGroup(this.node);
  }

  // Fusion nodes

  protected async connect(connectionNode: FSConnectionNode) {
    if (this.startLoading(connectionNode)) {
      try {
        const root = await FSApi.connect(connectionNode.connection);
        connectionNode.loaded = true;
        this.addCollection(connectionNode, root.collections[0]);
        this.expand(connectionNode.db);
        connectionNode.security = await this.addSecurity(connectionNode);
        connectionNode.indexes = await this.addIndexes(connectionNode);
        connectionNode.rest = await this.addRestNode(connectionNode);
        this.pushNodesToUpdate();
      } catch (error) {
        connectionNode.expanded = false;
        if (FSErrorObject.is(error)) {
          FSDialog.alert('New Connection',
            ERROR_MESSAGES[error.code] + ' "' + (error.data?.length && error.data[0]) + '"',
            // TODO: elaborate on the instructions, maybe link to a documentation page
            'You need to update your API to version "' + API_MINIMUM_VERSION + '" or higher.<br/>Visit <a href="https://fusiondb.com/">Fusion DB website</a> for more information on how to update.');
        } else {
          console.error('not caught:', error);
        }
      }
      this.endLoading(connectionNode);
    }
  }

  protected startLoading(node: TreeNode): boolean {
    if (FSNode.is(node)) {
      if (node.loading) {
        return false;
      } else {
        let parentNode = node.parent;
        while (FSNode.isItem(parentNode)) {
          if (parentNode.loading) {
            return false;
          }
          parentNode = parentNode.parent;
        }
      }
      node.loading = true;
      this.refresh();
      return true;
    }
    return false;
  }

  protected async endLoading(node: TreeNode) {
    if (FSNode.is(node)) {
      node.loading = false;
      await this.refresh();
      if (this.loadEvents[node.id]) {
        // const a =
        this.loadEvents[node.id] = await (await Promise.all(this.loadEvents[node.id].map(async event => {
          const result = event(node);
          if (!result) {
            return event;
          }
          if (result === true) {
            return null;
          }
          return await result ? null : event
        }))).filter(event => event != null) as FSLoadEvent[];
        if (this.loadEvents[node.id].length < 1) {
          delete(this.loadEvents[node.id]);
        }
      }
    }
    (window as any).loadEvents = this.loadEvents;
  }

  protected addLoadEvent(node: TreeNode, event: FSLoadEvent): void {
    if (FSNode.is(node)) {
      if (!this.loadEvents[node.id]) {
        this.loadEvents[node.id] = [event];
      } else {
        if (!this.loadEvents[node.id].find(value => value === event)) {
          this.loadEvents[node.id].push(event);
        }
      }
    }
  }

  protected removeLoadEvent(node: TreeNode, event?: FSLoadEvent): void {
    if (FSNode.is(node)) {
      if (this.loadEvents[node.id]) {
        if (event) {
          this.loadEvents[node.id] = this.loadEvents[node.id].filter(value => value != event);
          if (this.loadEvents[node.id].length < 1) {
            delete(this.loadEvents[node.id]);
          }
        } else {
          delete(this.loadEvents[node.id]);
        }
      }
    }
  }
  
  protected async asyncLoad(node: FSCollectionNode) {
    try {
      const result = await FSApi.load(node.connectionNode.connection, node.uri);
      if (FSItem.isCollection(result)) {
        const collection = result;
        // refresh collections
        let collectionsOld = node.children.filter(child => FSNode.isCollection(child)) as FSCollectionNode[];
        const collectionsNew = collection.collections.filter(subCollection => {
          const collectionNode = this.getNode(this.itemID(node.connectionNode.connection, subCollection));
          if (FSNode.isCollection(collectionNode) && collectionNode.parent === node) {
            collectionsOld = collectionsOld.filter(old => old !== collectionNode);
            collectionNode.collection = subCollection;
            return false;
          }
          return true;
        });
        collectionsOld.forEach(node => this.removeNode(node));
        collectionsNew.forEach(collection => this.addCollection(node, collection));
        // refresh documents
        let documentsOld = node.children.filter(child => FSNode.isDocument(child)) as FSDocumentNode[];
        const documentsNew = collection.documents.filter(subDocument => {
          const documentNode = this.getNode(this.itemID(node.connectionNode.connection, subDocument));
          if (FSNode.isDocument(documentNode) && documentNode.parent === node) {
            documentsOld = documentsOld.filter(old => old !== documentNode);
            documentNode.document = subDocument;
            return false;
          }
          return true;
        });
        documentsOld.forEach(node => this.removeNode(node));
        documentsNew.forEach(document => this.addDocument(node, document));
        // done refreshing
        (node as FSCollectionNode).collection = collection;
      }
    } catch (error) {
      (node as FSCollectionNode).loaded = false;
      (node as FSCollectionNode).expanded = false;
      console.error('caught:', error);
    }
  }
  
  protected async load(node: FSCollectionNode, uri: string) {
    if (this.startLoading(node)) {
      try {
        const result = await FSApi.load(node.connectionNode.connection, uri);
        if (FSItem.isCollection(result)) {
          node.loaded = true;
          const collection = result as FSCollection;
          await this.addCollectionIndex(node);
          await Promise.all(collection.collections.map(subCollection => this.addCollection(node, subCollection)));
          await Promise.all(collection.documents.map(document => this.addDocument(node, document)));
          node.collection = collection;
        }
        this.pushNodesToUpdate();
      } catch (error) {
        node.expanded = false;
        console.error('caught:', error);
      }
      this.endLoading(node);
    }
  }

  public async saveByUri(uri: string, connection: FSServerConnection, content: string) {
    return await FSApi.save(connection, uri, content);
  }

  public async save(document: FSDocumentNode, content: string) {
    try {
      const doc = await this.saveByUri(document.uri, document.connectionNode.connection, content);
      if (doc) {
        document.isNew = false;
        document.document = doc;
        this.refresh();
      }
    } catch (error) {
      console.error('caught:', error);
    }
  }

  protected async saveDocument(connection: FSServerConnection, uri: string, content: string | Blob, contenType = ''): Promise<boolean> {
    try {
      return await !!FSApi.save(connection, uri, content, contenType);
    } catch (error) {
      console.error('caught:', error);
      return false;
    }
  }

  public async saveDocuments(node: FSCollectionNode, documents: FSFileList | FormData): Promise<FSDocument[]> {
    try {
      this.startLoading(node);
      const docs = await FSApi.saveDocuments(node.connectionNode.connection, node.collection, documents);
      this.endLoading(node);
      this.asyncLoad(node);
      return docs;
    } catch (error) {
      this.endLoading(node);
      console.error('caught:', error);
      return [];
    }
  }

  protected async addConnection(connection: FSServerConnection, parent: CompositeTreeNode, expanded?: boolean): Promise<FSConnectionNode> {
    const shouldRefresh = this.isEmpty;
    const connectionNode = await this.addNode({
      type: 'connection',
      children: [],
      expanded,
      id: v4(),
      nodeId: this.connectionID(connection),
      connectionNode: (parent as FSContainerNode).connectionNode,
      connection,
      parent: parent as any,
      selected: false,
      nodeName: connection.name,
      uri: connection.server,
      db: undefined as any,
      security: undefined as any,
      indexes: undefined as any,
      rest: undefined as any,
    } as FSConnectionNode, parent) as FSConnectionNode;
    connectionNode.connectionNode = connectionNode;
    this.connectionAdded(connectionNode);
    this.addNodesToUpdate(connectionNode);
    this.pushNodesToUpdate();
    if (shouldRefresh) {
      this.refreshHeights();
    }
    return connectionNode;
  }
  addNodesToUpdate(...nodes: FSNode[]) {
    if (nodes.length < 1) return;
    this.nodesToUpdate = this.nodesToUpdate.concat(nodes.filter(node => !this.nodesToUpdate.find(_node => _node.id === node.id)));
  }
  pushNodesToUpdate() {
    if (this._labelProvider) {
      this._labelProvider.update(this.nodesToUpdate);
      this.nodesToUpdate = [];
    }
  }
  protected async addCollectionRecursive(connection: FSServerConnection, uri: string): Promise<FSCollectionNode> {
    const node = this.getNode(this.connectionID(connection) + uri);
    if (node) {
      if (FSNode.isCollection(node)) {
        return node;
      } else {
        throw createError(FSError.unknown);
      }
    } else {
      const parent = await this.addCollectionRecursive(connection, this.parentCollection(uri));
      return this.addCollection(parent, {
        created: new Date(),
        name: uri,
        acl: [],
        collections: [],
        documents: [],
        group: 'dba',
        owner: connection.username,
      });
    }
  }

  protected async addDocumentRecursive(connection: FSServerConnection, document: FSDocument, isNew: boolean = false): Promise<FSDocumentNode> {
    const parent = await this.addCollectionRecursive(connection, this.parentCollection(document.name));
    return this.addDocument(parent, document);
  }

  protected addDocument(parent: FSCollectionNode, document: FSDocument, isNew: boolean = false): FSDocumentNode {
    const name = this.getName(document.name);
    if (FSNode.isCollection(parent)) {
      document.name = this.collectionDir(parent.uri, name);
    }
    const node: FSDocumentNode = {
      type: 'item',
      connectionNode: parent.connectionNode,
      isCollection: false,
      id: v4(),
      nodeId: this.itemID(parent.connectionNode.connection, document),
      parent: parent,
      nodeName: name,
      link: FS_RESOURCE_SCHEME + ':' + document.name,
      isNew,
      selected: false,
      uri: document.name,
      document,
    };
    this.addNode(node, parent);
    return node;
  }

  protected async addCollection(parent: FSCollectionNode | FSConnectionNode, collection: FSCollection): Promise<FSCollectionNode> {
    const name = this.getName(collection.name);
    if (FSNode.isCollection(parent)) {
      collection.name = this.collectionDir(parent.uri, name);
    }
    const node: FSCollectionNode = {
      type: 'item',
      connectionNode: parent.connectionNode,
      isCollection: true,
      children: [],
      nodeName: name,
      id: v4(),
      nodeId: this.itemID(parent.connectionNode.connection, collection),
      link: FS_RESOURCE_SCHEME + ':' + collection.name,
      parent: parent as CompositeTreeNode,
      selected: false,
      expanded: false,
      collection,
      uri: collection.name,
    };
    return this.addNode(node, parent) as Promise<FSCollectionNode>;
  }

  protected async addUserNode(parent: FSUsersNode, user: string): Promise<FSNode> {
    const node: FSUserNode = {
      type: 'user',
      connectionNode: parent.connectionNode,
      id: v4(),
      nodeId: this.userID(parent.connectionNode.connection, user),
      description: user,
      nodeName: user,
      user,
      parent,
      uri: '/users/' + user,
      selected: false,
    };
    return this.addNode(node, parent) as Promise<FSNode>;
  }

  protected async refreshUsers(node: FSSecurityNode): Promise<void> {
    const users = await FSApi.getUsers(node.users.connectionNode.connection);
    let usersOld = node.users.children.filter(child => FSNode.isUser(child)) as FSUserNode[];
    const usersNew = users.filter(user => {
      const userNode = this.getNode(this.userID(node.users.connectionNode.connection, user));
      if (FSNode.isUser(userNode) && userNode.parent === node.users) {
        usersOld = usersOld.filter(old => old !== userNode);
        return false;
      }
      return true;
    });
    usersOld.forEach(node => this.removeNode(node));
    usersNew.forEach(user => this.addUserNode(node.connectionNode.security.users, user));
  }

  protected async addUsersNode(parent: FSSecurityNode, users: string[]): Promise<FSUsersNode> {
    const usersNode = await this.addNode({
      type: 'users',
      connectionNode: parent.connectionNode,
      children: [],
      id: v4(),
      nodeId: this.userID(parent.connectionNode.connection),
      description: 'Users',
      parent,
      nodeName: 'Users',
      uri: '/users',
      expanded: false,
      selected: false,
    } as FSUsersNode, parent) as FSUsersNode;
    await Promise.all(users.map(user => this.addUserNode(usersNode, user)));
    usersNode.loaded = true;
    return usersNode as FSUsersNode;
  }

  protected async addGroupNode(parent: FSGroupsNode, group: string): Promise<FSNode> {
    const node: FSGroupNode = {
      type: 'group',
      connectionNode: parent.connectionNode,
      id: v4(),
      nodeId: this.groupID(parent.connectionNode.connection, group),
      group,
      nodeName: group,
      description: group,
      parent,
      uri: '/groups/' + group,
      selected: false,
    };
    return this.addNode(node, parent) as Promise<FSNode>;
  }

  protected async refreshGroups(node: FSSecurityNode): Promise<void> {
    const groups = await FSApi.getGroups(node.groups.connectionNode.connection);
    let groupsOld = node.groups.children.filter(child => FSNode.isGroup(child)) as FSGroupNode[];
    const groupsNew = groups.filter(group => {
      const groupNode = this.getNode(this.groupID(node.groups.connectionNode.connection, group));
      if (FSNode.isGroup(groupNode) && groupNode.parent === node.groups) {
        groupsOld = groupsOld.filter(old => old !== groupNode);
        return false;
      }
      return true;
    });
    groupsOld.forEach(node => this.removeNode(node));
    groupsNew.forEach(group => this.addGroupNode(node.connectionNode.security.groups, group));
  }

  protected async addGroupsNode(parent: FSSecurityNode, groups: string[]): Promise<FSGroupsNode> {
    const groupsNode = await this.addNode({
      type: 'groups',
      connectionNode: parent.connectionNode,
      children: [],
      id: v4(),
      nodeId: this.groupID(parent.connectionNode.connection),
      description: 'Groups',
      nodeName: 'Groups',
      parent,
      uri: '/groups',
      expanded: false,
      selected: false,
    } as FSGroupsNode, parent) as FSGroupsNode;
    await Promise.all(groups.map(group => this.addGroupNode(groupsNode, group)));
    groupsNode.loaded = true;
    return groupsNode as FSGroupsNode;
  }

  protected async addSecurity(connectionNode: FSConnectionNode): Promise<FSSecurityNode> {
    const securityNode = await this.addNode({
      type: 'security',
      connectionNode,
      children: [],
      id: v4(),
      nodeId: this.securityID(connectionNode.connection),
      description: 'Security',
      nodeName: 'Security',
      parent,
      uri: '/security',
      expanded: false,
      selected: false,
    } as any, connectionNode) as FSSecurityNode;
    const users = await FSApi.getUsers(connectionNode.connection);
    securityNode.users = await this.addUsersNode(securityNode, users);
    const groups = await FSApi.getGroups(connectionNode.connection);
    securityNode.groups = await this.addGroupsNode(securityNode, groups);
    return securityNode;
  }

  protected createIndexNode(parent: FSContainerNode, index: string): FSIndexNode {
    return {
      connectionNode: parent.connectionNode,
      id: v4(),
      nodeId: this.indexID(parent.connectionNode.connection, index),
      parent: parent,
      index,
      nodeName: index,
      uri: index,
      type: 'index',
      selected: false,
    };
  }

  protected async addCollectionIndex(collectionNode: FSCollectionNode): Promise<FSIndexNode | undefined> {
    const index = await FSApi.getIndex(collectionNode.connectionNode.connection, collectionNode.uri);
    const indexNode = this.createIndexNode(collectionNode, collectionNode.uri);
    (indexNode as any).name = 'Indexes';
    return index ? await this.addNode(indexNode, collectionNode) as FSIndexNode : undefined;
  }

  protected async addIndex(indexesNode: FSIndexesNode, uri: string): Promise<FSIndexNode> {
    return await this.addNode(this.createIndexNode(indexesNode, uri), indexesNode) as FSIndexNode;
  }

  protected async refreshIndexes(connectionNode: FSConnectionNode): Promise<void> {
    const indexes = await FSApi.getIndexes(connectionNode.connection);
    let indexesOld = connectionNode.indexes.children.filter(child => FSNode.isIndex(child)) as FSIndexNode[];
    const indexesNew = indexes.filter(index => {
      const indexNode = this.getNode(this.indexID(connectionNode.connection, index));
      if (FSNode.isIndex(indexNode) && indexNode.parent === connectionNode.indexes) {
        indexesOld = indexesOld.filter(old => old !== indexNode);
        return false;
      }
      return true;
    });
    indexesOld.forEach(node => this.removeNode(node));
    indexesNew.forEach(index => this.addIndex(connectionNode.indexes, index));
  }

  protected async addIndexes(connectionNode: FSConnectionNode): Promise<FSIndexesNode> {
    const indexes = await FSApi.getIndexes(connectionNode.connection);
    const indexesNode = await this.addNode({
      connectionNode,
      children: [],
      id: v4(),
      nodeId: this.indexID(connectionNode.connection),
      parent: connectionNode,
      uri: '/index',
      type: 'indexes',
      nodeName: 'Indexes',
      selected: false,
      expanded: false,
    } as FSIndexesNode, connectionNode) as FSIndexesNode;
    await Promise.all(indexes.map(index => this.addIndex(indexesNode, index)));
    indexesNode.loaded = true;
    return indexesNode;
  }

  protected async addRestNode(connectionNode: FSConnectionNode): Promise<FSRestNode> {
    const rest = await this.addNode({
      type: 'rest',
      children: [],
      id: v4(),
      nodeId: this.restID(connectionNode.connection),
      uri: 'rest',
      nodeName: 'RestXQ',
      parent: connectionNode,
      selected: false,
      expanded: false,
      connectionNode,
    } as FSRestNode, connectionNode) as FSRestNode;
    const uris = await FSApi.restxq(connectionNode.connection);
    await Promise.all(uris.filter(uri => uri.uri !== '/').map(async uri => {
      const uriNode = await this.addNode({
        type: 'rest-uri',
        children: [],
        id: v4(),
        nodeId: this.restID(connectionNode.connection, uri.uri),
        uri: 'rest',
        restURI: uri,
        parent: rest,
        nodeName: uri.uri,
        selected: false,
        expanded: false,
        connectionNode,
      } as FSRestURINode, rest) as FSRestURINode;
      uri.methods.forEach(method => this.addNode({
        type: 'rest-method',
        id: v4(),
        nodeId: this.restID(connectionNode.connection, uri.uri, method.name),
        uri: 'rest',
        restMethod: method,
        parent: uriNode,
        selected: false,
        nodeName: method.name,
        connectionNode,
      } as FSRestMethodNode, uriNode))
    }));
    await this.sort(rest, this.sortRest);
    return rest;
  }

  public status() {
    const nodes = this.topNodesSp(this.selection);
    if (nodes.length) {
      this.statusEntry.active = true;
      if (nodes.length > 1) {
        this.statusEntry.text = 'selection: ' + nodes.length.toString();
        this.statusEntry.arguments = [];
      } else {
        const node = nodes[0];
        this.statusEntry.arguments = [node.nodeId];
        if (FSNode.isConnection(node)) {
          this.statusEntry.text = `$(toggle-on) "${node.connectionNode.connection.name}" by "${node.connectionNode.connection.username}" to ${node.connectionNode.connection.server}`;
        } else if (FSNode.isCollection(node)) {
          this.statusEntry.text = `$(folder) ${node.nodeName} (${this.getGroupOwner(node.collection)})`;
        } else if (FSNode.isDocument(node)) {
          this.statusEntry.text = `$(file${node.document.binaryDoc ? '' : '-code'}-o) ${node.nodeName} (${this.getGroupOwner(node.document)})`;
        }
      }
    } else {
      this.statusEntry.active = false;
    }
    if (this.statusEntry.active) {
      this.statusBar.setElement(STATUSBAR_ELEMENT, this.statusEntry);
    } else {
      this.statusBar.removeElement(STATUSBAR_ELEMENT);
    }
  }

  // clipboard
  public canMoveTo(source: FSItemNode[], collectionUri: string): boolean {
    return !source.map(node => node.uri)
      .find(source => collectionUri.indexOf(source) >= 0 || collectionUri === source.substr(0, source.lastIndexOf('/')));
  }

  protected setClipboard(nodes: FSItemNode[], copy?: boolean) {
    this.clipboard.source = nodes;
    this.clipboard.copy = copy;
  }

  public canPaste(): boolean {
    return !!this.clipboard.source &&
      this.clipboard.source.length > 0 &&
      this.canMoveTo(this.clipboard.source, this.node ? this.node.uri : '/');
  }

  // info

  // functionalities
  
  protected getConnectionIcon(node: FSConnectionNode): string {
    return 'toggle-' + (node.loaded ? 'on' : 'off');
  }
  
  protected getCollectionIcon(node: FSCollectionNode): string {
    return 'folder' + (node.expanded ? '-open' : '') + (node.loaded ? '' : '-o');
  }

  protected getDocumentIcon(node: FSDocumentNode): string {
    return 'file' + (node.loaded ? '' : '-o');
  }

  public getIcon(node: FSNode): string {
    const loading = 'spin fa-spinner';
    if (FSNode.isConnection(node)) {
      return 'fa fa-fw fa-' + (node.loading ? loading : this.getConnectionIcon(node));
    }
    if (FSNode.isCollection(node)) {
      return 'fa fa-fw fa-' + (node.loading ? loading : this.getCollectionIcon(node));
    }
    if (FSNode.isDocument(node)) {
      return 'fa fa-fw fa-' + (node.loading ? loading : this.getDocumentIcon(node));
    }
    if (FSNode.isGroup(node) || FSNode.isGroups(node)) {
      return 'fa fa-fw fa-' + (node.loading ? loading : 'users');
    }
    if (FSNode.isUser(node) || FSNode.isUsers(node)) {
      return 'fa fa-fw fa-' + (node.loading ? loading : 'user');
    }
    if (FSNode.isSecurity(node)) {
      return 'fa fa-fw fa-' + (node.loading ? loading : 'lock');
    }
    if (FSNode.isIndexes(node) || FSNode.isIndex(node)) {
      return 'fa fa-fw fa-' + (node.loading ? loading : 'list-ul');
    }
    if (FSNode.isRest(node)) {
      return 'fa fa-fw fa-server';
    }
    if (FSNode.isRestURI(node)) {
      return 'fa fa-fw fa-link';
    }
    if (FSNode.isRestMethod(node)) {
      let icon: string;
      switch(node.name) {
        case 'GET': icon = 'upload'; break;
        case 'PUT': icon = 'download'; break;
        case 'POST': icon = 'paper-plane'; break;
        case 'DELETE': icon = 'trash'; break;
        default: icon = 'link'; break;
      }
      return 'fa fa-fw fa-' + icon;
    }
    return '';
  }

  protected getGroupOwner(item: FSItem): string {
    let result = '';
    if (item.group) {
      result = item.group;
    }
    if (item.owner) {
      result += (result ? ':' : '') + item.owner;
    }
    return (item.owner || '(n/a)') + ':' + (item.group || '(n/a)');
  }

  public execute(action: string) {
    this.commands.executeCommand(actionID(action));
  }

  public topNodes(nodes: FSItemNode[]): FSItemNode[] {
    return nodes.filter(node => FSNode.isItem(node))
      .filter(node => {
      let parent = node.parent
      while (parent && FSNode.isCollection(parent)) {
        if (this.selection.indexOf(parent as any) > -1) {
          return false;
        }
        parent = parent.parent;
      }
      return true;
    });
  }

  public topNodesSp(nodes: FSItemNode[]): FSItemNode[] {
    return nodes.filter(node => FSNode.is(node))
      .filter(node => {
      let parent = node.parent
      while (parent && FSNode.isContainer(parent)) {
        if (this.selection.indexOf(parent as any) > -1) {
          return false;
        }
        parent = parent.parent;
      }
      return true;
    });
  }

  protected fileExists(name: string, node?: FSCollectionNode): boolean {
    node = (node && FSNode.isCollection(node)) ? node : ((this.node && FSNode.isCollection(this.node)) ? this.node : undefined);
    if (node) {
      return !!node.children.find(file => FSNode.isItem(file) && file.nodeName === name);
    }
    return false;
  }
  
  public getName(id: string): string {
    return id.split('/').pop() || id;
  }
  
  public generateID(connection: FSServerConnection, text: string, prefix?: string): string {
    return this.connectionID(connection) + (prefix ? prefix + '/' : '') + text;
  }
  
  public ID(node: FSNode): string {
    if (FSNode.isItem(node)) {
      return this.itemID(node.connectionNode.connection, FSNode.isCollection(node) ? node.collection : (node as FSDocumentNode).document);
    }
    if (FSNode.isConnection(node)) {
      return this.connectionID(node.connection);
    }
    if (FSNode.isSecurity(node)
    || FSNode.isUser(node)
    || FSNode.isGroup(node)
    || FSNode.isIndex(node)
    || FSNode.isRest(node)) {
      return this.securityID(node.connectionNode.connection);
    }
    console.dir(node);
    throw 'unknown node type';
  }
  
  public connectionID(connection: FSServerConnection): string {
    return (connection.username ? connection.username : '(guest)') + '@' + connection.server;
  }

  public itemID(connection: FSServerConnection, item: FSItem): string {
    return this.connectionID(connection) + (item.name.length < 1 || item.name[0] != '/' ? '/' : '') + item.name;
  }
  
  public securityID(connection: FSServerConnection, prefix?: string, text?: string): string {
    return this.connectionID(connection) + '/security' + (prefix ? '/' + prefix + (text ? '/' + text : ''): '');
  }

  public userID(connection: FSServerConnection, user: string = ''): string {
    return this.securityID(connection, 'user', user);
  }

  public groupID(connection: FSServerConnection, group: string = ''): string {
    return this.securityID(connection, 'group', group);
  }

  protected indexID(connection: FSServerConnection, uri: string = ''): string {
    return this.connectionID(connection) + '/index' + uri;
  }
  
  protected restID(connection: FSServerConnection, prefix?: string, text?: string): string {
    return this.connectionID(connection) + '/rest' + (prefix ? prefix + (text ? '/' + text : ''): '');
  }

  protected parentCollection(uri: string): string {
    const parent = uri.split(TRAILING_SYMBOL);
    parent.pop();
    return parent.join(TRAILING_SYMBOL);
  }
  
  protected async changeOwner(node: FSItemNode, owner: string, group: string): Promise<boolean> {
    const isCollection = FSNode.isCollection(node);
    return await FSApi.chmod(node.connectionNode.connection, node.uri, owner, group, isCollection);
  }
  
  protected async rename(node: FSItemNode, name: string): Promise<boolean> {
    if (FSNode.isCollection(node.parent)) {
      const parent = node.parent;
      const nodes = await this.move({
        copy: false,
        destination: [this.collectionDir(parent.uri, name)],
        destinationContainer: node.parent,
        source: [node],
        event: undefined as any,
      });
      if (nodes.length === 1) {
        this.select(nodes[0]);
        return true;
      } else {
        return false;
      }
    } else {
      throw createError(FSError.unknown);
    }
  }

  public async acceptName(node: FSNode, name: string): Promise<boolean> {
    return FSNode.isItem(node) && node.isNew
      ? this.tryCreate(node, name)
      : this.tryRename(node, name);
  }

  public async cancelName(node: FSNode): Promise<void> {
    if (FSNode.isItem(node) && node.isNew) {
      this.updating = true;
      this.removeNode(node);
      this.updating = false;
    }
    this.setRename();
  }

  public validateName(node: FSNode, newName: string, failsOnSameName = false): string {
    newName = newName.trim();
    if (!node) {
      return 'No node to rename';
    }
    if (newName === '') {
      return 'Empty name';
    }
    // TODO: valid name
    if (FSNode.isItem(node)) {
      const collection = node.parent as FSCollectionNode;
      if (newName === node.nodeName) {
        if (failsOnSameName) {
          return 'Same name';
        } else {
          return '';
        }
      }
      if (this.fileExists(newName, collection)) {
        return 'Item already exists';
      }
    } else if (FSNode.isConnection(node)) {
      if (newName === node.nodeName) {
        if (failsOnSameName) {
          return 'Same name';
        } else {
          return '';
        }
      }
      if (Object.keys(this.connections).find(nodeId => this.connections[nodeId].name === newName)) {
        return 'A connection with this name already exists.';
      }
    }
    return '';
  }

  public async tryCreate(node: FSNode, name: string): Promise<boolean> {
    if (FSNode.isItem(node)) {
      try {
        if (FSNode.isDocument(node)) {
          // const result = await this.rename(node, name);
          // this.setRename();
          // return result;
        } else if (FSNode.isCollection(node)) {
          const parent = (node.parent as FSCollectionNode);
          const uri = parent.uri + TRAILING_SYMBOL + name;
          const collection = await FSApi.newCollection(node.connectionNode.connection, uri);
          this.updateNode(node, collection.name);
          this.setRename();
          node.isNew = false;
          return true;
        }
      } catch(e) {
        this.removeNode(node);
        this.setRename();
      }
      return false;
    } else {
      this.removeNode(node);
      this.setRename();
      throw createError(FSError.unknown);
    }
  }
  
  public async tryRename(node: FSNode, name: string): Promise<boolean> {
    if (node.nodeName === name) {
      this.setRename();
      return false;
    }
    if (FSNode.isItem(node)) {
      const result = await this.rename(node, name);
      this.setRename();
      return result;
    } else if (FSNode.isConnection(node)) {
      this.connectionDeleted(node);
      const updatedNode = this.updateNode(node, name);
      this.connectionAdded(updatedNode);
      this.setRename();
      return !!updatedNode;
    } else {
      throw createError(FSError.unknown);
    }
  }

  public async openDocumentByURI(uri: string, connection: FSServerConnection): Promise<any> {
    const uriObj = new URI(FS_RESOURCE_SCHEME + ':' + this.connectionID(connection) + uri);
    const evalWidget = await this.widgetManager.getWidget(FS_EVAL_WIDGET_FACTORY_ID);
    if (!evalWidget) {
      const ext = uri.substr(uri.lastIndexOf('.') + 1);
      if (XQ_EXT.indexOf(ext) >= 0) {
        this.commands.executeCommand('FusionEval:toggle');
      }
    }
    const result = await open(this.openerService, uriObj);
    return result;
  }

  public async openDocument(node: FSDocumentNode): Promise<any> {
    if (this.startLoading(node)) {
      const result = await this.openDocumentByURI(node.uri, node.connectionNode.connection);
      this.endLoading(node);
      node.loaded = true;
      return result;
    }
  }

  protected async createDocument(collection: FSCollectionNode, name: string, content = '', group = '', owner = '') {
    const doc = await this.openDocument(this.addDocument(collection, {
      content,
      name,
      created: new Date(),
      lastModified: new Date(),
      binaryDoc: false,
      acl: [],
      size: content.length,
      mediaType: lookup(name) || 'text/plain',
      group: group || 'dba',
      owner: owner || collection.connectionNode.connection.username,
    }, true));
    if (content !== '') {
      doc.editor.document.setDirty(true);
      doc.editor.document.contentChanges.push({
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 }
        },
        rangeLength: 0,
        content,
      });
    }
    return doc;
  }

  protected blob(text: string, type: string): Blob {
    return new Blob([new Uint8Array(text.split('').map(c => c.charCodeAt(0)))], { type });
  }

  protected collectionDir(collection: string, document: string): string {
    if ((collection[collection.length - 1] != TRAILING_SYMBOL) &&
        (document[0] != TRAILING_SYMBOL)) {
          collection += TRAILING_SYMBOL;
        }
    return collection + document;
  }

  protected clean(array: string[], topDir: string = '') {
    if (topDir !== '') {
      return array.map(i => i.substr(topDir.length));
    }
    const testArray: (string | undefined)[][] = array.map(i => i.split(TRAILING_SYMBOL));
    if (array.length > 0) {
      if (array.length === 1) {
        testArray[0] = [testArray[0].pop()];
      } else {
        while (testArray[0].length > 1) {
          const test = testArray[0][0];
          let check = true;
          testArray.forEach(i => check = check && i[0] === test);
          if (check) {
            testArray.forEach(i => i.shift());
          }
        }
      }
    }
    return testArray.map(i => i.join(TRAILING_SYMBOL));
  }

  protected cleanItems(array: FSDocument[], topDir: string): FSItem[] {
    let result = array.map(doc => {
      let pos = doc.name.indexOf(TRAILING_SYMBOL, topDir.length + 1);
      return {
        ...doc,
        name: pos > 0 ? doc.name.substr(0, pos) : doc.name,
      }
    });
    result = result.filter(item => {
      if (FSItem.isCollection(item)) {
        return true;
      }
      const copy: FSCollection | undefined = result.find(found => found.name === (item as any).name && found != item) as any;
      if (copy) {
        copy.collections = [];
        copy.documents = [];
        return false;
      }
      return true;
    });
    return result;
  }

  protected getTopDir(array: string[]): string {
    let result = '';
    const testArray: (string | undefined)[][] = array.map(i => i.split(TRAILING_SYMBOL));
    if (array.length > 0) {
      if (array.length === 1) {
        testArray[0].pop();
        result = testArray[0].join(TRAILING_SYMBOL) + TRAILING_SYMBOL;
      } else {
        while (testArray.map(i => i.length).reduce((a, b) => Math.min(a, b), 2) > 1) {
          const test = testArray[0][0];
          let check = true;
          testArray.forEach(i => check = check && i[0] === test);
          if (check) {
            testArray.forEach(i => i.shift());
            result += test + TRAILING_SYMBOL;
          }
        }
      }
    }
    return result;
  }

  protected cleanObject(object: FSFileList, topDir: string = ''): FSFileList {
    const keys = Object.keys(object);
    const array = this.clean(keys, topDir);
    keys.forEach((key, index) => {
      object[array[index]] = object[key];
      delete(object[key]);
    });
    return object;
  }

  protected nextName(check?: string) {
    if (check && check != this.lastName()) {
      return;
    }
    this.lastNameID++;
  }

  protected lastName(ext?: string): string {
    return 'untitled-' + this.lastNameID.toString() + (ext ? '.' + ext : '');
  }

  protected newName(validator?: (input: string) => boolean, ext?: string): string {
    if (validator) {
      while (!validator(this.lastName(ext))) {
        this.nextName();
      }
    }
    return this.lastName(ext);
  }

  public updateNode<T extends FSNode>(node: T, name: string): T {
    const item = FSNode.isCollection(node) ? node.collection : FSNode.isDocument(node) ? node.document : null;
    if (item) {
      item.name = name;
      node.uri = item.name;
    } else if (FSNode.isConnection(node)) {
      node.connection.name = name;
    } else if (FSNode.isUser(node)) {
      node.user = name;
      node.uri = '/users/' + name;
    } else if (FSNode.isGroup(node)) {
      node.group = name;
      node.uri = '/groups/' + name;
    } else if (FSNode.isIndex(node)) {
      node.index = name;
      node.uri = name;
    }
    node.nodeName = this.getName(name);;
    delete(this.dict[node.nodeId]);
    node.nodeId = this.ID(node);
    this.dict[node.nodeId] = node;
    return node;
  }

  public sameParent(uri1: string, uri2: string): boolean {
    const ids1 = uri1.split('/');
    const ids2 = uri2.split('/');
    if (ids1.length !== ids2.length) {
      return false;
    }
    for (let i = 0; i < ids2.length - 1; i++) {
      if (ids1[i] !== ids2[i]) {
        return false;
      }
    }
    return true;
  }

  public async move(operation: FSDragOperation): Promise<FSItemNode[]> {
    const toDelete: FSNode[] = [];
    // const toDelete: FSNode[] = [];
    if (operation.source.length) {
      this.updating = true;
      let result = (await asyncForEach(operation.source, async (source: FSItemNode, i) => {
        const isCollection = FSNode.isCollection(source);
        const result = await FSApi.move(
          source.connectionNode.connection,
          source.uri,
          operation.destination[i],
          isCollection,
          operation.copy
        );
        if (result) {
          if (this.sameParent(source.uri, operation.destination[i])) {
            return this.updateNode(source, operation.destination[i]);
          } else {
            let resultNode: FSItemNode;
            if (isCollection) {
              resultNode = await this.addCollection(operation.destinationContainer, {
                ...(source as FSCollectionNode).collection,
                name: operation.destination[i],
              });
            } else {
              resultNode = this.addDocument(operation.destinationContainer, {
                ...(source as FSDocumentNode).document,
                name: operation.destination[i],
              });
            }  
            if (!operation.copy) {
              toDelete.push(source);
            }
            return resultNode;
          }
        }
      })).filter(node => !!node) as FSItemNode[];
      // TODO: implement softRefresh method
      // let container: FSNode | undefined;
      // container = this.getNode(id);
      if (toDelete.length > 0) {
        this.expand(operation.destinationContainer);
        await asyncForEach(toDelete, (node: FSNode) => this.removeNode(node));
      }
      await this.model?.refresh();
      this.updating = true;
      return result;
    } else {
      return [];
    }
  }

  // commands
  
  public async newConnection(): Promise<void> {
    if (!this.model) {
      return;
    }
    const dialog = new FSConnectionDialog({
      title: 'New Connection',
      name: 'localhost',
      server: 'http://localhost:4059',
      username: 'admin',
      password: '',
    });
    const result = await dialog.open();
    if (result) {
      this.addConnection(result.connection, this.model.root as CompositeTreeNode, result.autoConnect);  
    }
  }

  protected get isEmpty(): boolean {
    return !this.model?.root || (this.model.root as CompositeTreeNode).children.length < 2;
  }

  public async deleteConnection(): Promise<void> {
    if (!this.isSelected || !this.model) {
      return;
    }
    if (this.node && FSNode.isConnection(this.node)) {
      const node = this.node as FSConnectionNode;
      const msg = document.createElement('p');
      msg.innerHTML = 'Are you sure you want to remove the connection: <strong>' + node.connectionNode.nodeName + '</strong>?<br/>' +
      'Server URI: <strong>' + node.connectionNode.connection.server + '</strong><br/>' +
      'Username: <strong>' + node.connectionNode.connection.username + '</strong>';
      const dialog = new ConfirmDialog({
        title: 'Remove Connection',
        msg,
        cancel: 'Keep',
        ok: 'Delete'
      });
      const result = await dialog.open();
      if (result) {
        this.connectionDeleted(node);
        this.removeNode(node);
        this.model.refresh();
        if (this.isEmpty) {
          this.refreshHeights();
        }
      } else {
        this.model.selectNode(node);
      }
    }
  }

  public async newItem(isCollection?: boolean, content = '', extension = ''): Promise<boolean> {
    if (!this.node) {
      return false;
    }
    const collection = this.node as FSCollectionNode;
    await this.ensureExpanded(collection);
    const validator = (input: string) => input !== '' && !this.fileExists(input);
    let initialName = this.newName(validator);
    if (extension) {
      initialName += '.' + extension;
    }
    const name = collection.uri + TRAILING_SYMBOL + initialName;
    this.nextName(initialName);
    let item: FSItemNode;
    if (isCollection) {
      item = await this.addCollection(collection, {
        name,
        owner : 'admin',
        group : 'dba',
        acl : [ ],
        documents : [ ],
        created : new Date(),
        collections : [ ]
      });
    } else {
      item = this.addDocument(collection, {
        content,
        name,
        created: new Date(),
        lastModified: new Date(),
        binaryDoc: false,
        acl: [],
        size: 0,
        mediaType: lookup(name) || 'text/plain',
        group: 'dba',
        owner: collection.connectionNode.connection.username,
      }, true);
    }
    item.isNew = true;
    this.setRename(item);
    if (FSNode.isDocument(item)) {
      const safeAccept = this.acceptName;
      this.acceptName = async (n, name) => {
        await this.setRename(false);
        await this.removeNode(item);
        const documentNode = this.addDocument(collection, { ...(item as FSDocumentNode).document, name }, true);
        const doc = await this.openDocument(documentNode);
        this.acceptName = safeAccept;
        if (content !== '') {
          doc.editor.document.setDirty(true);
          doc.editor.document.contentChanges.push({
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 }
            },
            rangeLength: 0,
            content,
          });
        }
        return !!doc;
      }
    }
    return true;
  }

  public async uploadItem(): Promise<boolean> {
    const props: OpenFileDialogProps = {
      title: 'Upload file',
      canSelectFolders: true,
      canSelectFiles: true,
      canSelectMany: true,
    };
    const [rootStat] = await this.workspace.roots;
    const file: URI | URI[] = await this.fileDialog.showOpenDialog(props, rootStat) as any;
    const selectedFiles = (Array.isArray(file) ? file : [file]).map(f => f.path.toString());
    const top = this.getTopDir(selectedFiles);
    const files = await this.files.getFiles({ file: selectedFiles });
    const collectionNode = this.node as FSCollectionNode;
    const filenameList: any = await this.files.readMulti({ files });
    const formData = new FormData();
    this.cleanObject(filenameList, top);
    let counter = 1;
    for (let i in filenameList) {
      formData.append('file-upload-' + counter++, this.blob(filenameList[i], lookup(i) || 'application/octet-stream'), i);
    }
    this.saveDocuments(collectionNode, formData);
    return true;
  }

  public async newItemFromResult(collection?: FSCollectionNode): Promise<boolean> {
    if (!this.result) {
      return false;
    }
    if (!FSNode.isCollection(collection)) {
      if (FSNode.isCollection(this.node)) {
        collection = this.node;
      } else if (FSNode.isDocument(this.node)) {
        collection = this.node.parent as FSCollectionNode;
      }
    }
    if (FSNode.isCollection(collection)) {
      await this.ensureExpanded(collection);
      const validator = (input: string) => input !== '' && !this.fileExists(input);
      const dialog = new SingleTextInputDialog({
        initialValue: this.newName(validator),
        title: 'New document',
        confirmButtonLabel: 'Create',
        validate: validator,
      });
      let name = await dialog.open();
      if (name) {
        await this.createDocument(collection, name, this.result);
        return true;
      }
    }
    return false;
  }

  public async newItemFromTemplate(template: FSTemplate): Promise<boolean> {
    if (!this.node) {
      return false;
    }
    // const collection = this.node as FSCollectionNode;
    const validator = (filename: string) => filename !== '' && !this.fileExists(filename);
    // const initialName = this.newName(validator, template.ext({}));
    let result: FSNewFromTemplateDialogResult | undefined;
    if (template.fields) {
      const dialog = new FSNewFromTemplateDialog({
        title: 'New ' + template.name,
        template,
        validate: validator,
      });
      result = await dialog.open();
      if (!result) {
        return false;
      }
    }
    // this.nextName(initialName);
    // const name = collection.uri + '/' + initialName;
    const text = template.execute(result?.params);
    await this.newItem(false, text, template.ext(result?.params));
    return false;
  }

  public isRenaming(node?: FSNode) {
    return node ? node.nodeId === this.renaming : this.renaming !== '';
  }

  public async setRename(node?: FSNode | false, focus = true) {
    this.updating = true;
    this.renaming = node ? node.nodeId : '';
    if (focus == true || node !== false) {
      const serversWidget = await this.widgetManager.getWidget(FS_CONNECTIONS_WIDGET_FACTORY_ID);
      if (serversWidget) {
        // serversWidget.activate();
      }
    }
    this.updating = false;
    await this.refresh();
  }

  public async renameItem(): Promise<void> {
    if (FSNode.isItem(this.node) || FSNode.isConnection(this.node)) {      
      // const collection = this.node.parent as FSCollectionNode;
      // const validator = (input: string) => input === (this.node && this.node.nodeName) || input !== '' && !this.fileExists(input, collection);
      this.setRename(this.node);
    }
  }

  public cut() {
    this.setClipboard(this.topNodes(this.selection));
  }

  public copy() {
    this.setClipboard(this.topNodes(this.selection), true);
  }

  public paste() {
    if (FSNode.isCollection(this.node) && this.clipboard.source) {
      const collection = this.node;
      const destination = this.clipboard.source.map(item => this.collectionDir(collection.uri, item.uri.split('/').pop() || ''));
      this.move({
        copy: !!this.clipboard.copy,
        destinationContainer: collection,
        event: undefined as any,
        source: this.clipboard.source,
        destination
      })
    }
  }

  public async refresh(node?: CompositeTreeNode) {
    if (this.model) {
      if (FSNode.isCollection(node)) {
        this.model.collapseNode(node);
        node.loaded = false;
        this.empty(node);
        this.expand(node);
        return;
      } else {
        return this.model.refresh(node);
      }
    }
  }
  
  public async refreshHeights(node?: CompositeTreeNode) {
    if (this.model) {
      this.tree?.refreshHeights();
    }
  }
  
  public async deleteItem(): Promise<void> {
    const deleteNode = async function (core: FSCore, node: FSItemNode) {
      try {
        const done = await FSApi.remove(node.connectionNode.connection, node.uri, FSNode.isCollection(node));
        if (done) {
          if (FSNode.isDocument(node) && node.editor) {
            node.editor.closeWithoutSaving();
            // TODO: keep the file in the editor as a new one
            // node.editor.saveable.setDirty(true);
          }
          core.removeNode(node);
        }
      } catch (error) {
        console.error('caught:', error);
      }
    };
    if (!this.isSelected || !this.model) {
      return;
    }
    const collections: any[] = [];
    const documents: any[] = [];
    let nodes = this.topNodes(this.selection);
    nodes.forEach(node => (FSNode.isCollection(node) ? collections : documents).push(node));
    const isMultiple = nodes.length > 1;
    if (nodes.length > 0) {
      const isCollection = FSNode.isCollection(this.node);
      const node = this.node as FSDocumentNode;
      const msg = document.createElement('p');
      if (nodes.length === 1) {
        msg.innerHTML = 'Are you sure you want to delete the ' + (isCollection ? 'collection' : 'document') + ': <strong>' + node.nodeName + '</strong>?';
      } else {
        msg.innerHTML = '<p>Are you sure you want to delete the following items?</p>';
        if (collections.length > 0) {
          msg.innerHTML += '<strong>Collection:</strong><ul>' + collections.map(node => '<li>' + node.nodeName + '</li>').join('') + '</ul>';
        }
        if (documents.length > 0) {
          msg.innerHTML += '<strong>Document:</strong><ul>' + documents.map(node => '<li>' + node.nodeName + '</li>').join('') + '</ul>';
        }
      }
      const dialog = new ConfirmDialog({
        title: 'Delete ' + (isMultiple ? 'items' : isCollection ? 'collection' : 'document'),
        msg,
        cancel: 'Keep',
        ok: 'Delete'
      });
      const result = await dialog.open();
      if (result) {
        await Promise.all(nodes.map(node => deleteNode(this, node)));
        this.model && this.model.refresh();
      } else {
        this.model.selectNode(node);
      }
    }
  }

  public openMethodFunctionDocument(nodeId = '') {
    const node = !nodeId || (this.node && this.node.nodeId !== nodeId) ? this.node : this.getNode(nodeId);
    if (FSNode.isRestMethod(node)) {
      this.openDocumentByURI(node.restMethod.function.src, node.connectionNode.connection);
    }
  }
// TDOD: add server info interface and functions
  public async serverInfo(node?: FSConnectionNode) {
    function serverInfoToString(server: any): string {
      return `Api:
- Version: ${server.version}
Server:
- Product: ${server.server['product-name']}
- Version: ${server.server.version}
- Revision: ${server.server.revision}
- Build: ${server.server.build}`;
    }
    node = node && FSNode.isConnection(node) ? node : FSNode.isConnection(this.node) ? this.node : undefined;
    if (node) {
      const connection = node.connectionNode.connection;
      const server = await FSApi.serverInfo(connection);
      FSDialog.alert(connection.name + '\'s server info', serverInfoToString(server));
    }
  }

  public showPropertiesDialog(nodeId = '') {
    const node = !nodeId || (this.node && this.node.nodeId !== nodeId) ? this.node : this.getNode(nodeId);
    if (node) {
      if (FSNode.isConnection(node)) {
        const dialog = new FSConnectionDialog({
          title: 'Edit Connection',
          acceptButton: 'Save',
          ...node.connectionNode.connection,
        });
        dialog.open().then(result => {
          if (result) {
            this.empty(node);
            node.uri = result.connection.server;
            node.connection = result.connection;
            this.connectionDeleted(node);
            const newNode = this.updateNode(node, result.connection.name);
            this.connectionAdded(newNode);
            newNode.expanded = false;
            newNode.loading = false;
            newNode.loaded = false;
            newNode.selected = false;
            this.expand(newNode);
          }
        });
      } else if (FSNode.isItem(node)) {
        const parent = node.parent as FSCollectionNode;
        const dialog = new FSPropertiesDialog({
          title: 'Properties',
          node: this.node,
          validate: filename => filename !== '' && !this.fileExists(filename, parent)
        });
        dialog.open().then(async result => {
          if (result) {
            const item = FSNode.isCollection(node) ? node.collection as FSCollection : (node as FSDocumentNode).document as FSDocument;
            if (result.name !== node.nodeName) {
              await this.rename(node, result.name);
            }
            if ((result.owner !== item.owner) || (result.group !== item.group)) {
              await this.changeOwner(node, result.owner, result.group);
            }
          }
        });
      }
    }
  }

  public canDeleteUser(): boolean {
    return FSNode.isUser(this.node) && this.node.nodeName != 'admin' && this.node.nodeName != 'guest';
  }

  public async deleteUser() {
    if (FSNode.isUser(this.node) && this.model) {
      const dialog = new ConfirmDialog({
        title: 'Delete user',
        msg: 'Are you sure you want to delete the user "' + this.node.user + '"?',
        cancel: 'Keep',
        ok: 'Delete'
      });
      const result = await dialog.open();
      if (result) {
        if (await FSApi.removeUser(this.node.connectionNode.connection, this.node.user)) {
          this.removeNode(this.node);
        }
      }
    }
  }

  public async editUser() {
    if (FSNode.isUser(this.node)) {
      const connectionNode = this.node.connectionNode;
      const user = await FSApi.getUser(connectionNode.connection, this.node.user);
      const dialog = new FSUserDialog({
        title: 'Edit User: ' + this.node.user,
        acceptButton: 'Save changes',
        connection: connectionNode.connection,
        user,
      });
      let userData = await dialog.open();
      if (userData) {
        if (await FSApi.addUser(connectionNode.connection, userData)) {
          this.node.connectionNode.connection.users.push(user.userName);
          this.addUserNode(connectionNode.security.users, user.userName);
        }
      }
    }
  }

  public async addUser() {
    if (FSNode.is(this.node)) {
      const connectionNode = this.node.connectionNode;
      const dialog = new FSUserDialog({
        title: 'Add User',
        connection: connectionNode.connection
      });
      let user = await dialog.open();
      if (user) {
        if (await FSApi.addUser(connectionNode.connection, user)) {
          this.node.connectionNode.connection.users.push(user.userName);
          this.addUserNode(connectionNode.security.users, user.userName);
        }
      }
    }
  }

  public canDeleteGroup(): boolean {
    return FSNode.isGroup(this.node) && this.node.nodeName != 'dba' && this.node.nodeName != 'guest';
  }

  public async deleteGroup() {
    if (FSNode.isGroup(this.node) && this.model) {
      const dialog = new ConfirmDialog({
        title: 'Delete group',
        msg: 'Are you sure you want to delete the group "' + this.node.group + '"?',
        cancel: 'Keep',
        ok: 'Delete'
      });
      const result = await dialog.open();
      if (result) {
        if (await FSApi.removeGroup(this.node.connectionNode.connection, this.node.group)) {
          this.removeNode(this.node);
        }
      }
    }
  }

  public async editGroup() {
    if (FSNode.isGroup(this.node)) {
      const connectionNode = this.node.connectionNode;
      const group = await FSApi.getGroup(connectionNode.connection, this.node.group);
      const dialog = new FSGroupDialog({
        title: 'Edit Group: ' + this.node.group,
        acceptButton: 'Save changes',
        connection: connectionNode.connection,
        group,
      });
      let groupData = await dialog.open();
      if (groupData) {
        if (await FSApi.addGroup(connectionNode.connection, groupData)) {
          this.node.connectionNode.connection.groups.push(group.groupName);
          this.addGroupNode(connectionNode.security.groups, group.groupName);
        }
      }
    }
  }

  public async addGroup() {
    if (FSNode.is(this.node)) {
      const connectionNode = this.node.connectionNode;
      const dialog = new FSGroupDialog({
        title: 'Add Group',
        connection: connectionNode.connection
      });
      let group = await dialog.open();
      if (group) {
        if (await FSApi.addGroup(connectionNode.connection, group)) {
          this.node.connectionNode.connection.groups.push(group.groupName);
          this.addGroupNode(connectionNode.security.groups, group.groupName);
        }
      }
    }
  }
}