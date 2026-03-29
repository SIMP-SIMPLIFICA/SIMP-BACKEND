const Handlebars = require('handlebars');
const template = Handlebars.compile(`
{{#if remetente_assinou}}
  {{#if ../logo}}
    YES
  {{else}}
    NO
  {{/if}}
{{/if}}
`);
try {
    console.log(template({ remetente_assinou: true, logo: 'hello' }));
} catch (e) {
    console.error(e);
}
