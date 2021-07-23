import { TreeNode, ExpandableTreeNode, SelectableTreeNode, CompositeTreeNode } from "@theia/core/lib/browser";
import { FSDocument, FSCollection } from "./item";
import { FSServerConnection } from "./connection";
import { FSRestURI, FSRestMethod } from "./rest";


export type FSNodeType = 'connection' | 'toolbar' | 'item' | 'users' | 'groups' | 'user' | 'group' | 'security' | 'indexes' | 'index' | 'rest' | 'rest-uri' | 'rest-method';
export type FSLoadEvent = (mode: FSNode) => void | true | Promise<void | true>;

export interface FSNode extends TreeNode {
  type: FSNodeType;
  connectionNode: FSConnectionNode;
  uri: string;
  nodeName: string;
  nodeId: string;
  loading?: boolean;
  loaded?: boolean;
}
export interface FSContainerNode extends FSNode, CompositeTreeNode, ExpandableTreeNode {}

export interface FSConnectionNode extends FSNode, FSContainerNode, SelectableTreeNode {
  type: 'connection';
  connection: FSServerConnection;
  db: FSCollectionNode;
  security: FSSecurityNode
  indexes: FSIndexesNode
  rest: FSRestNode
}
export interface FSToolbarNode extends FSNode {
  type: 'toolbar';
}
export interface FSItemNode extends FSNode, SelectableTreeNode {
  // type: 'item';
  link: string;
  isCollection: boolean;
  isNew?: boolean;
}
export interface FSCollectionNode extends FSItemNode, FSContainerNode {
  collection: FSCollection;
  isCollection: true;
}
export interface FSDocumentNode extends FSItemNode {
  document: FSDocument;
  isCollection: false;
  editor?: any;
}
export interface FSUserNode extends FSNode, SelectableTreeNode {
  type: 'user',
  user: string;
}
export interface FSUsersNode extends FSContainerNode, SelectableTreeNode {
  type: 'users',
}
export interface FSGroupNode extends FSNode, SelectableTreeNode {
  type: 'group',
  group: string;
}
export interface FSGroupsNode extends FSContainerNode, SelectableTreeNode {
  type: 'groups',
}
export interface FSSecurityNode extends FSContainerNode, SelectableTreeNode {
  type: 'security',
  users: FSUsersNode,
  groups: FSGroupsNode,
}
export interface FSIndexNode extends FSNode, SelectableTreeNode {
  type: 'index',
  index: string,
}
export interface FSIndexesNode extends FSContainerNode, SelectableTreeNode {
  type: 'indexes',
}

export interface FSRestNode extends FSContainerNode, SelectableTreeNode {
  type: 'rest',
}
export interface FSRestURINode extends FSContainerNode, SelectableTreeNode {
  type: 'rest-uri',
  restURI: FSRestURI,
}
export interface FSRestMethodNode extends FSNode, SelectableTreeNode {
  type: 'rest-method',
  restMethod: FSRestMethod,
}

export namespace FSNode {
  export function is(node?: TreeNode): node is FSNode {
    return !!node && 'type' in node;
  }
  export function isContainer(node?: TreeNode): node is FSContainerNode {
    return FSNode.is(node) && CompositeTreeNode.is(node) && ExpandableTreeNode.is(node);
  }
  export function isConnection(node?: TreeNode): node is FSConnectionNode {
    return FSNode.is(node) && node.type === 'connection';
  }
  export function isToolbar(node?: TreeNode): node is FSToolbarNode {
    return FSNode.is(node) && node.type === 'toolbar';
  }
  export function isItem(node?: TreeNode): node is FSItemNode {
    return FSNode.is(node) && node.type === 'item';
  }
  export function isCollection(node?: TreeNode): node is FSCollectionNode {
    return FSNode.isItem(node) && node.isCollection;
  }
  export function isDocument(node?: TreeNode): node is FSDocumentNode {
    return FSNode.isItem(node) && !node.isCollection;
  }
  export function isUser(node?: TreeNode): node is FSUserNode {
    return FSNode.is(node) && node.type === 'user';
  }
  export function isUsers(node?: TreeNode): node is FSUsersNode {
    return FSNode.isContainer(node) && node.type === 'users';
  }
  export function isGroup(node?: TreeNode): node is FSGroupNode {
    return FSNode.is(node) && node.type === 'group';
  }
  export function isGroups(node?: TreeNode): node is FSGroupsNode {
    return FSNode.isContainer(node) && node.type === 'groups';
  }
  export function isSecurity(node?: TreeNode): node is FSSecurityNode {
    return FSNode.isContainer(node) && node.type === 'security';
  }
  export function isIndex(node?: TreeNode): node is FSIndexNode {
    return FSNode.is(node) && node.type === 'index';
  }
  export function isIndexes(node?: TreeNode): node is FSIndexesNode {
    return FSNode.isContainer(node) && node.type === 'indexes';
  }
  export function isRest(node?: TreeNode): node is FSRestNode {
    return FSNode.isContainer(node) && node.type === 'rest';
  }
  export function isRestURI(node?: TreeNode): node is FSRestURINode {
    return FSNode.isContainer(node) && node.type === 'rest-uri';
  }
  export function isRestMethod(node?: TreeNode): node is FSRestMethodNode {
    return FSNode.is(node) && node.type === 'rest-method';
  }
}