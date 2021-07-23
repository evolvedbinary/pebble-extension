import { mkApiPathUrl, fsUrl } from '../support/config.js';
import { dialogMainButton } from '../support/utils.js';

const content = {
  text: 'Test text file.',
  xml: [
    '<file>',
    '<name>test.xml</name>',
    '<modified>23 Mar 17 22:20</modified>',
    '<owner>root</owner>',
    '</file>',
  ],
}

context('Fusion Studio', function () {
  before(function () {
    cy.visit(fsUrl)
      .get('#theia-top-panel', { timeout: 30000 })
      .should('be.visible')
      .get('.theia-preload').should('not.exist');
    cy.addConnection();
    cy.waitForLoading();
    cy.getTreeNode(mkApiPathUrl('admin', '/db')).click();
    cy.addCollection(mkApiPathUrl('admin', '/db'), 'uploads');
    cy.waitForLoading();
    cy.getTreeNode(mkApiPathUrl('admin', '/db/uploads')).click();
  });
  describe('Uploading', function () {
    it('One document', function () {
      cy.dragFileTo(mkApiPathUrl('admin', '/db/uploads'), 'test.txt');
      cy.waitForLoading();
      cy.getTreeNode(mkApiPathUrl('admin', '/db/uploads/test.txt')).should('be.visible').contains('test.txt');
      
      cy.getTreeNode(mkApiPathUrl('admin', '/db/uploads/test.txt')).dblclick();
      cy.waitForLoading();
      cy.get('.p-Widget.p-TabBar li[title*=' + CSS.escape('/db/uploads/test.txt') + ']').click();
      cy.get('[role=presentation].editor-scrollable').contains(content.text);
    });
    it('Multiple documents', function () {
      cy.dragFileTo(mkApiPathUrl('admin', '/db/uploads'), {
        'test2.txt': 'test.txt',
        'test.xml': 'test.xml',
      });
      cy.waitForLoading();
      cy.checkDocumentText(mkApiPathUrl('admin', '/db/uploads/test2.txt'), content.text);
      cy.checkDocumentText(mkApiPathUrl('admin', '/db/uploads/test.xml'), content.xml);
    });
    it('Directories', function () {
      cy.dragFileTo(mkApiPathUrl('admin', '/db/uploads'), {
        intro: 'test.txt',
        'testDir': {
          'description.md': 'test.txt',
          'txts': {
            'file1.txt': 'test.txt',
            'file2.txt': 'test.txt',
            'file3.txt': 'test.txt',
          },
          'xmls': {
            'file1.xml': 'test.xml',
            'file2.xml': 'test.xml',
            'file3.xml': 'test.xml',
          },
        }
      });
      cy.waitForLoading();
      cy.checkDocumentText(mkApiPathUrl('admin', '/db/uploads/intro'), content.text);
      cy.getTreeNode(mkApiPathUrl('admin', '/db/uploads/testDir')).click();
      cy.checkDocumentText(mkApiPathUrl('admin', '/db/uploads/testDir/description.md'), content.text);
      cy.getTreeNode(mkApiPathUrl('admin', '/db/uploads/testDir/txts')).click();
      cy.checkDocumentText(mkApiPathUrl('admin', '/db/uploads/testDir/txts/file1.txt'), content.text);
      cy.checkDocumentText(mkApiPathUrl('admin', '/db/uploads/testDir/txts/file2.txt'), content.text);
      cy.checkDocumentText(mkApiPathUrl('admin', '/db/uploads/testDir/txts/file3.txt'), content.text);
      cy.getTreeNode(mkApiPathUrl('admin', '/db/uploads/testDir/xmls')).click();
      cy.checkDocumentText(mkApiPathUrl('admin', '/db/uploads/testDir/xmls/file1.xml'), content.xml);
      cy.checkDocumentText(mkApiPathUrl('admin', '/db/uploads/testDir/xmls/file2.xml'), content.xml);
      cy.checkDocumentText(mkApiPathUrl('admin', '/db/uploads/testDir/xmls/file3.xml'), content.xml);
      
      cy.getTreeNode(mkApiPathUrl('admin', '/db/uploads')).rightclick();
      cy.getMenuCommand('fusion.delete').should('be.visible').click();
      cy.get(dialogMainButton).should('be.visible').click();
      cy.waitForLoading();
    });
  });
});
