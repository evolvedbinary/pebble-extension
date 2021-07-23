// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// see https://github.com/javierbrea/cypress-localstorage-commands
// import "cypress-localstorage-commands"

// -- This is a parent command --
// populate localStorage with a default connection, automatically cleared before each spec
// assumes default 'admin' user and '' password
// actual server URL is retrieved via ENV
Cypress.Commands.add("connect", () => {
  // conn_val mimics actual app behavior, its value is inconsequential for establishing a connection
  let conn_val = 'admin@' + Cypress.env('API_HOST')
  let nested = { "name": "localhost", "server": Cypress.env('API_HOST'), "username": "admin", "password": "", "users": [], "groups": [] }
  let obj = {}
  obj[conn_val] = nested

  localStorage.setItem('connections', JSON.stringify(obj))

})
Cypress.Commands.overwrite('visit', (orig, url, options) => {
  // this is a fix to include the process variable when using the Electron browser
  return orig(url, Cypress.isBrowser('electron') ? {
    ...options,
    onBeforeLoad(win) {
      win.process = Cypress.config('process');
      if (options?.onBeforeLoad) {
        options.onBeforeLoad(win);
      }
    }
  } : options);

})
Cypress.Commands.add("extendedFiles", () => {
  return cy.window().then(win => {
    win.ExFile = class extends win.File {
      constructor(root, data, fileName, options) {
        super(data, fileName, options);
        this.root = root;
      }
      webkitGetAsEntry() {
        const me = this;
        return {
          isDirectory: false,
          isFile: true,
          fullPath: this.root + this.name,
          file: callback => callback(this),
        };
      }
    }
    win.ExDir = class extends win.ExFile {
      constructor(root, entries, fileName, options) {
        super(root, [], fileName, options);
        this.entries = entries.map(entry => entry.webkitGetAsEntry());
      }
      webkitGetAsEntry() {
        const me = this;
        return {
          isDirectory: true,
          isFile: false,
          fullPath: this.root + this.name,
          createReader: () => ({ readEntries: callback => callback(this.entries) }),
        };
      }
    }
    return win;
  });
})
//
//
// -- This is a child command --
// Cypress.Commands.add("drag", { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add("dismiss", { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This is will overwrite an existing command --
// Cypress.Commands.overwrite("visit", (originalFn, url, options) => { ... })
