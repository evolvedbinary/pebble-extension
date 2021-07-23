/// <reference types="Cypress" />
import { FSApi } from '../../fusion-studio-extension/src/common/api';

context('Document Operations', () => {
  describe('working with tree view', () => {
    let fetchSpy;
    const connection = {
      server: Cypress.env('API_HOST'),
      username: 'admin',
      password: '',
    };
    before(() => {
      new Cypress.Promise(async resolve => {
        await FSApi.remove(connection, '/db/test', true).catch(e => { });
        await FSApi.newCollection(connection, '/db/test');
        await FSApi.newCollection(connection, '/db/test/col1');
        await FSApi.save(connection, '/db/test/col1/doc1', '');
        await FSApi.save(connection, '/db/test/col1/doc2', '');
        resolve();
      })
      cy.connect()
      cy.visit('/', {
        onBeforeLoad: win => fetchSpy = cy.spy(win, 'fetch'),
      })
      cy.get(`[node-id=${CSS.escape('admin@' + Cypress.env('API_HOST'))}]`)
      // TODO(DP): might have to improve by adding more before / after hooks to prevent dangling documents
      // see #400
    })
    after(() => {
      // delete the test colelction
      new Cypress.Promise(resolve => FSApi.remove(connection, '/db/test', true).then(resolve).catch(resolve))
    })
    afterEach(() => {
      // make sure the tree has rendered all its items properly
      cy.wait(10)
    })
    it('should display creation options', () => {
      cy.get('.fusion-view', { timeout: 55000 })
        .should('be.visible')
      cy.get('.fusion-item')
        .click()
      // (DP): start workaround for #413
      cy.get('[node-id$=db]')
        .click()
        .prev().should('not.have.class', 'fa-spin').wait(1)
      // (DP): end workaround for #413
      //  all we need is the final part of the node-id attribute
      cy.get('[node-id$=test]')
        .click()
        .prev().should('not.have.class', 'fa-spin').wait(1)
      cy.get('[node-id$=test]')
        .rightclick()
      cy.get('.p-Menu')
        .should('be.visible')
        .contains('New document...')
        .trigger('mousemove')
      cy.get('[data-command="fusion.new-document"]')
        .contains('Empty document')
        .click()
      cy.focused()
        .type('untitled_1{enter}')
      cy.get('.fusion-view')
        .contains('untitled_1')

      // TODO(DP):
      // - add test for #413 : change order, remove workaround, might need a call to focused()
      // - check if tree view is deselected (it is but need not be), 
      // - check if Explorer is updated properly (seems inconsistent need to double click)
      // - check if editor window is opening the newly create doc in a new tab (it doesn't)
      // - two doc create routes one with follow-up dialog (xquery lib) one without (txt, xml)
    })

    // see https://github.com/cypress-io/cypress/pull/15388/docs#
    // see #414

    it('should let users edit new document', () => {
      cy.get('[node-id$=untitled_1]')
        .dblclick()
      if (Cypress.platform === 'darwin') {
        cy.get('.view-line')
          .type('asdf{meta+s}')
      } else {
        cy.get('.view-line')
          .type('asdf{ctrl+s}')
      }
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/untitled_1', {
        method: 'PUT',
        body: 'asdf',
      });
    })
    // see #414 workaround is to run this after editing and saving the document, 
    // we should be able to rename before entering content
    it('should let users rename documents', () => {
      cy.get('[node-id$=untitled_1]')
        .rightclick()
      cy.get('[data-command="fusion.rename"]')
        .should('be.visible')
        .contains('Rename')
        .click()
        .focused()
        .type('test.txt{enter}')
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/test.txt', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/untitled_1' },
      });
    })

    it('should display document properties', () => {
      cy.get('[node-id$="test.txt"]')
        .rightclick()
      cy.get('.p-Menu')
        .should('be.visible')
        .find('[data-command="fusion.properties"]')
        .contains('Properties...')
        .click();
      cy.get('.dialogTitle')
        .should('contain.text', 'Properties')
      // rename doc -> text.xml
      cy.get('.value > .theia-input')
        .clear()
        .type('test.xml')
      // check properties table 
      cy.get('.dialogContent')
        .find('.keys > tr')
        .should('have.length', 11)
        .contains('Media Type')
      cy.get('.dialogContent')
        .find('.keys > tr')
        .contains('Owner')
      // check permissions table  
      cy.get('.dialogContent')
        .find('.permissions-editor > tr')
        .should('have.length', 3)
        .contains('user')
      cy.get('.main')
        .click()
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/test.xml', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/test.txt' },
      });
    })

    it('should not create duplicate documents', () => {
      cy.get('[node-id$=test]')
        .rightclick()
      cy.get('.p-Menu')
        .should('be.visible')
        .contains('New document')
        .trigger('mousemove')
      cy.get('[data-command="fusion.new-document-template:xml"] > .p-Menu-itemLabel')
        .should('be.visible')
        .click()
      cy.get('.fs-inline-input > .theia-input')
        .clear()
        .type('test.xml{enter}')
      cy.get('.error')
        .should('exist')
        .should('contain.text', 'Item already exists')
      cy.get('.fs-inline-input > .theia-input')
        .type('{esc}')
    })

    it('should upload a document using drag and drop', () => {
      cy.extendedFiles().then(win => {
        const file = new win.ExFile('/', [new Blob(['sample text content.'])], 'upload_test.txt', { type: 'text/plain' })

        const originalDataTransfer = new win.DataTransfer();
        originalDataTransfer.items.add(file);
        const dataTransfer = {
          ...originalDataTransfer,
          items: [file],
          files: [file],
        };
        dataTransfer.getData = (...args) => originalDataTransfer.getData(...args);

        cy.get('[node-id$=test]')
          .trigger('dragover', { dataTransfer })
          .trigger('drop', { dataTransfer })
        fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/upload_test.txt', { method: 'PUT' })
        cy.get('[node-id$="test\\/upload_test.txt"]')
          .should('be.visible')
      })
    })

    it('should upload a document using the upload dialog', () => {
      cy.writeFile(require('path').resolve(Cypress.env('homedir'), 'upload_file_test.txt'), 'sample text content');
      cy.get('[node-id$=test]')
        .rightclick()
      cy.get('[data-command="fusion.upload-document"]')
        .should('be.visible')
        .contains('Upload document(s)')
        .click()
      cy.get('.dialogBlock .theia-Tree.theia-FileTree')
      const timer = Date.now();
      new Cypress.Promise((resolve, reject) => {
        function tick() {
          const file = cy.$$('.theia-TreeNode:contains(upload_file_test.txt)');
          if (file.length) {
            cy.wrap(file[0])
              .click({ force: true })
            cy.get('.main').click();
            fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxqs/fusiondb/document?uri=/db/test/upload_file_test.txt', { method: 'PUT' })
            cy.get('[node-id$="test\\/upload_file_test.txt"]')
              .should('be.visible')
            resolve();
          } else {
            if (Date.now() < timer + 5000) {
              cy.get('.theia-FileTree.theia-FileDialog.ps .ps__rail-y').click('bottom', { force: true })
              cy.wait(100).then(tick);
            }
          }
        }
        tick()
      })
    })

    it('should move a document', () => {
      const dataTransfer = new DataTransfer();
      cy.get('[node-id$="test\\/test.xml"]')
        .should('be.visible')
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$=col1]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/col1/test.xml', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/test.xml' },
      })
      cy.get('[node-id$="test\\/test.xml"]')
        .should('not.exist')
      cy.get('[node-id$="col1\\/test.xml"]')
        .should('be.visible')
    })

    it('should copy a document', () => {
      const dataTransfer = new DataTransfer();
      cy.get('[node-id$="col1\\/test.xml"]')
        .should('be.visible')
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$=test]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer, ctrlKey: true })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/test.xml', {
        method: 'PUT',
        headers: { 'x-fs-copy-source': '/db/test/col1/test.xml' },
      })
      cy.get('[node-id$="col1\\/test.xml"]')
        .should('be.visible')
      cy.get('[node-id$="test\\/test.xml"]')
        .should('be.visible')
    })

    it('should move more than one document', () => {
      const dataTransfer = new DataTransfer();
      cy.get('[node-id$="col1\\/doc1"]')
        .should('be.visible')
        .click()
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$="col1\\/doc2"]')
        .should('be.visible')
        .click({ ctrlKey: true })
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$=test]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/doc1', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/col1/doc1' },
      })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/doc2', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/col1/doc2' },
      })
      cy.get('[node-id$="col1\\/doc1"]')
        .should('not.exist')
      cy.get('[node-id$="col1\\/doc2"]')
        .should('not.exist')
      cy.get('[node-id$="test\\/doc1"]')
        .should('be.visible')
      cy.get('[node-id$="test\\/doc2"]')
        .should('be.visible')
    })

    it('should copy more than one document', () => {
      const dataTransfer = new DataTransfer();
      cy.get('[node-id$="test\\/doc1"]')
        .should('be.visible')
        .click()
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$="test\\/doc2"]')
        .should('be.visible')
        .click({ ctrlKey: true })
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$=col1]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer, ctrlKey: true })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/col1/doc1', {
        method: 'PUT',
        headers: { 'x-fs-copy-source': '/db/test/doc1' },
      })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/col1/doc2', {
        method: 'PUT',
        headers: { 'x-fs-copy-source': '/db/test/doc2' },
      })
      cy.get('[node-id$="test\\/doc1"]')
        .should('be.visible')
      cy.get('[node-id$="test\\/doc2"]')
        .should('be.visible')
      cy.get('[node-id$="col1\\/doc1"]')
        .should('be.visible')
      cy.get('[node-id$="col1\\/doc2"]')
        .should('be.visible')
    })

    it('should let users delete documents', () => {
      cy.get('[node-id$="test\\/test.xml"]')
        .rightclick()
      cy.get('[data-command="fusion.delete"] > .p-Menu-itemLabel')
        .should('be.visible')
        .click()
      cy.get('.main')
        .click()
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/test.xml', { method: 'DELETE' });
      // make sure all test docs are gone see #400
      cy.get('[node-id$=test\\/untitled_1]')
        .should('not.exist')
      cy.get('[node-id$="test\\/test.txt"]')
        .should('not.exist')
      cy.get('[node-id$="test\\/test.xml"]')
        .should('not.exist')
      cy.get('[node-id$=test\\/untitled-2]')
        .should('not.exist')
    })
  })
})