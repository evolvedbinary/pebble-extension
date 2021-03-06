/// <reference types="Cypress" />

context('Talking to the api directly', () => {
  describe('API version', () => {
    before(function() {
      cy.connect();
      cy.visit('/');
    });
    it('should fail to connect with older api', () => {
      cy.intercept('GET', Cypress.env('API_HOST') + '/exist/restxq/fusiondb/version', { fixture: 'bad_api' });
      cy.get('.fusion-item').click().then(() => {
        cy.get('.dialogTitle').should('contain.text', 'New Connection');
        cy.get('.dialogContent').should('be.visible')
          .should('contain.text', 'Outdated API "0.0.1"')
          .should('contain.text', 'You need to update your API to version "0.2.0" or higher');
        cy.get('.theia-button.main').should('be.visible').click();
        cy.get('.dialogBlock').should('not.exist');
      });
    });
    it('should connect with newer api', () => {
      cy.window().then(function(win) {
        const fetchSpy = cy.spy(win, 'fetch');
        fetchSpy.withArgs(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/version').as('/version');
        fetchSpy.withArgs(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/explorer?uri=/').as('/explorer');
        fetchSpy.withArgs(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/user').as('/user');
        fetchSpy.withArgs(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/group').as('/group');
        fetchSpy.withArgs(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/index').as('/index');
        fetchSpy.withArgs(Cypress.env('API_HOST') + '/exist/restxq/fusiondb/restxq').as('/restxq');
        cy.get('.fusion-item').click();
        cy.get('.fusion-view')
          .should('contain', 'db')
          .should('contain', 'RestXQ');
        cy.get('@/version').should('be.called');
        cy.get('@/explorer').should('be.called');
        cy.get('@/user').should('be.called');
        cy.get('@/group').should('be.called');
        cy.get('@/index').should('be.called');
        cy.get('@/restxq').should('be.called');
      });
    });
  });
})