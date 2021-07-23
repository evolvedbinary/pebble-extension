/// <reference types="Cypress" />
import { FSApi } from '../../fusion-studio-extension/src/common/api';

context('Collection Operations', () => {
  describe('working with tree view', () => {
    let fetchSpy;
    const connection = {
      server: Cypress.env('API_HOST'),
      username: 'admin',
      password: '',
    };
    before(() => {
      // prepare collections and documents used in the test
      new Cypress.Promise(async resolve => {
        await FSApi.remove(connection, '/db/test', true).catch(e => { });
        await FSApi.newCollection(connection, '/db/test');
        await FSApi.newCollection(connection, '/db/test/col1');
        await FSApi.save(connection, '/db/test/col1/test.txt', 'test text file');
        resolve();
      })
      cy.connect()
      cy.visit('/', {
        onBeforeLoad(win) {
          fetchSpy = cy.spy(win, 'fetch')
        }
      });
    })
    after(() => {
      // delete the test collection
      new Cypress.Promise(resolve => FSApi.remove(connection, '/db/test', true).then(resolve).catch(resolve))
    })
    afterEach(() => {
      // make sure the tree has rendered all its items properly
      cy.wait(10)
    })

    it('should display creation options', () => {
      cy.get('.fusion-view')
        .should('be.visible')
      cy.get('.fusion-item')
        .click()
      //  all we need is the final part of the node-id attribute
      // (DP): start workaround for #413
      cy.get('[node-id$=db]')
        .click()
        .prev().should('not.have.class', 'fa-spin')
      // (DP): end workaround for #413
      cy.get('[node-id$=test]')
        .click()
        .prev().should('not.have.class', 'fa-spin')
      fetchSpy.calledWith(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/explorer?uri=/db');
      fetchSpy.calledWith(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/explorer?uri=/db/test');
      cy.get('[node-id$=test]')
        .rightclick();
      cy.get('.p-Menu')
        .should('be.visible')
        .find('[data-command="fusion.new-collection"]')
        .should('be.visible')
        .contains('New collection')
        .click()
      cy.focused()
        .type('{enter}')
      cy.get('.fusion-view')
        .contains('untitled-1')
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/untitled-1', { method: 'PUT' });
    })

    it('should let users rename collection', () => {
      cy.get('[node-id$=untitled-1]')
        .rightclick()
      cy.get('[data-command="fusion.rename"]')
        .should('be.visible')
        .contains('Rename')
        .click()
      cy.focused()
        .type('test_col{enter}')
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/test_col', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/untitled-1' },
      });
      cy.get('.fusion-view')
        .contains('test_col')
      cy.get('[node-id$=untitled-1]')
        .should('not.exist')
    })

    it('should display collection properties', () => {
      cy.get('[node-id$=test_col]')
        .click()
        .type('{alt+enter}', { force: true })
      cy.get('.dialogTitle')
        .should('contain.text', 'Properties')
      // rename file -> text.xml
      cy.get('.value > .theia-input')
        .should('have.value', 'test_col')
        .clear()
        .type('test_col2')
      // check properties table 
      cy.get('.dialogContent')
        .find('.keys > tr')
        .should('have.length', 7)
        .should('contain', 'Created')
        .should('contain', 'Owner')
        .should('contain', 'Group')
      // check permissions table  
      cy.get('.dialogContent')
        .find('.permissions-editor > tr')
        .should('have.length', 3)
        .should('contain', 'user')
        .should('contain', 'group')
        .should('contain', 'other')
      cy.get('.main')
        .click()
      cy.get('.dialogBlock')
        .should('not.exist');
      cy.get('[node-id$=test_col2]')
        .should('exist')
      cy.get('[node-id$=test_col]')
        .should('not.exist')
    })

    it('should not create duplicate collection', () => {
      cy.get('[node-id$=test]')
        .rightclick()
        .then(() => {
          cy.get('.p-Menu')
            .should('be.visible')
            .contains('New collection')
            .trigger('mousemove')
          cy.get('[data-command="fusion.new-collection"]')
            .should('be.visible')
            .click()
          cy.focused()
            .clear()
            .type('test_col2{enter}')
          cy.get('.error')
            .should('exist')
            .should('contain.text', 'Item already exists')
        })
    })

    it('should create nested collection', () => {
      cy.get('[node-id$=test_col2]')
        .click()
        .rightclick()
      cy.get('.p-Menu')
        .should('be.visible')
        .contains('New collection')
      cy.get('[data-command="fusion.new-collection"]')
        .should('be.visible')
        .click()
      cy.focused()
        .clear()
        .type('test_colA{enter}')
      // TODO(DP): we migh want to check the proper nesting more explicitely,
      // but that is already covered by checking for this collection after deleting
      // its parent collection 
      cy.get('.fusion-view')
        .contains('test_colA')
        .should('exist')
    })

    it('should upload a collection', () => {
      cy.extendedFiles().then(win => {
        const file = new win.ExFile('/uploaded_col/', [new Blob(['sample text content.'])], 'uploaded_test.txt', { type: 'text/plain' })
        const dir = new win.ExDir('/', [file], 'uploaded_col')

        const originalDataTransfer = new win.DataTransfer();
        originalDataTransfer.items.add(file);
        const dataTransfer = {
          ...originalDataTransfer,
          items: [dir],
          files: [dir],
        };
        dataTransfer.getData = (...args) => originalDataTransfer.getData(...args);

        cy.get('[node-id$=test]')
          .trigger('dragover', { dataTransfer })
          .trigger('drop', { dataTransfer })
        fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/document?uri=/db/test/uploaded_col', { method: 'PUT' })
        cy.get('[node-id$="test\\/uploaded_col"]')
          .should('be.visible')
          .click()
        cy.get('[node-id$="uploaded_col\\/uploaded_test.txt"]')
          .should('be.visible')
      })
    })

    it('should move a collection', () => {
      const dataTransfer = new DataTransfer();
      cy.get('[node-id$="test\\/col1"]')
        .should('be.visible')
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$=test_col2]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/test_col2/col1', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/col1' },
      })
      cy.get('[node-id$="test_col\\/col1"]')
        .should('not.exist')
      cy.get('[node-id$="test_col2\\/col1"]')
        .should('be.visible')
        .click()
      cy.get('[node-id$="test_col2\\/col1\\/test.txt"]')
        .should('be.visible')
    })

    it('should copy a collection', () => {
      const dataTransfer = new DataTransfer();
      cy.get('[node-id$="test\\/test_col2\\/col1"]')
        .should('be.visible')
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$=test]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer, ctrlKey: true })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/col1', {
        method: 'PUT',
        headers: { 'x-fs-copy-source': '/db/test/test_col2/col1' },
      })
      cy.get('[node-id$="test\\/test_col2\\/col1"]')
        .should('be.visible')
      cy.get('[node-id$="test\\/test_col2\\/col1\\/test.txt"]')
        .should('be.visible')
      cy.get('[node-id$="test\\/col1"]')
        .should('be.visible')
        .click()
      cy.get('[node-id$="test\\/col1\\/test.txt"]')
        .should('be.visible')
    })

    it('should move more than one collection', () => {
      const dataTransfer = new DataTransfer();
      cy.get('[node-id$="test_col2\\/col1"]')
        .should('be.visible')
        .click()
      cy.get('[node-id$="test_col2\\/test_colA"]')
        .should('be.visible')
        .click({ ctrlKey: true })
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$=test\\/col1]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/col1/col1', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/test_col2/col1' },
      })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/col1/test_colA', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/test_col2/test_colA' },
      })
      cy.get('[node-id$="test_col2\\/col1"]')
        .should('not.exist')
      cy.get('[node-id$="test_col2\\/test_colA"]')
        .should('not.exist')
      cy.get('[node-id$="col1\\/test_colA"]')
        .should('be.visible')
      cy.get('[node-id$="col1\\/col1"]')
        .should('be.visible')
        .click()
      cy.get('[node-id$="col1\\/col1\\/test.txt"]')
        .should('be.visible')
    })

    it('should copy more than one collection', () => {
      const dataTransfer = new DataTransfer();
      cy.get('[node-id$="col1\\/test_colA"]')
        .should('be.visible')
        .click()
      cy.get('[node-id$="col1\\/col1"]')
        .should('be.visible')
        .click({ ctrlKey: true })
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$=test\\/test_col2]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer, ctrlKey: true })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/test_col2/col1', {
        method: 'PUT',
        headers: { 'x-fs-copy-source': '/db/test/col1/col1' },
      })
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/test_col2/test_colA', {
        method: 'PUT',
        headers: { 'x-fs-copy-source': '/db/test/col1/test_colA' },
      })
      cy.get('[node-id$="col1\\/col1"]')
        .should('be.visible')
      cy.get('[node-id$="col1\\/test_colA"]')
        .should('be.visible')
      cy.get('[node-id$="col1\\/col1\\/test.txt"]')
        .should('be.visible')
      cy.get('[node-id$="test_col2\\/test_colA"]')
        .should('be.visible')
      cy.get('[node-id$="test_col2\\/col1"]')
        .should('be.visible')
        .click()
      cy.get('[node-id$="test_col2\\/col1\\/test.txt"]')
        .should('be.visible')
    })

    it('should not move a collection to one of its sub-collections', () => {
      const dataTransfer = new DataTransfer();
      cy.get('[node-id$="test\\/col1"]')
        .should('be.visible')
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$=test\\/col1\\/col1]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer })
      fetchSpy.neverCalledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/col1/col1/col1', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/test/col1' },
      })
      cy.get('[node-id$="test\\/col1"]')
        .should('be.visible')
      cy.get('[node-id$="test\\/col1\\/col1\\/col1"]')
        .should('not.exist')
      cy.get('[node-id$="col1\\/col1\\/test.txt"]')
        .should('be.visible')
    })

    it('should not copy a collection to one of its sub-collections', () => {
      const dataTransfer = new DataTransfer();
      cy.get('[node-id$="test\\/col1"]')
        .should('be.visible')
        .trigger('dragstart', { dataTransfer })
      cy.get('[node-id$=test\\/col1\\/col1]')
        .trigger('dragover', { dataTransfer })
        .trigger('drop', { dataTransfer, ctrlKey: true })
      fetchSpy.neverCalledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/col1/col1/col1', {
        method: 'PUT',
        headers: { 'x-fs-move-source': '/db/test/test/col1' },
      })
      cy.get('[node-id$="test\\/col1"]')
        .should('be.visible')
      cy.get('[node-id$="test\\/col1\\/col1\\/col1"]')
        .should('not.exist')
      cy.get('[node-id$="col1\\/col1\\/test.txt"]')
        .should('be.visible')
    })

    it('should let users delete collection', () => {
      cy.get('[node-id$=test_col2]')
        .rightclick()
      cy.get('[data-command="fusion.delete"]')
        .should('be.visible')
        .contains('Delete')
        .click()
      cy.get('.main')
        .click()
      fetchSpy.calledWithMatch(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/collection?uri=/db/test/test_col2', { method: 'DELETE' });
      // make sure all test files are gone see #400, including those produced by failed create commands
      cy.get('[node-id$=untitled-1]')
        .should('not.exist')
      cy.get('[node-id$=untitled-2]')
        .should('not.exist')
      cy.get('[node-id$=test_col]')
        .should('not.exist')
      cy.get('[node-id$=test_col1]')
        .should('not.exist')
      cy.get('[node-id$=test_col2]')
        .should('not.exist')
    })
  })
})