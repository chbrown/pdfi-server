var Router = require('regex-router');
var pdfi_graphics = require('pdfi/graphics');

var R = new Router(function(req, res) {
  res.status(404).die('No resource at: ' + req.url);
});

/** GET /files/:name/pages
*/
R.get(/\/pages$/, function(req, res) {
  var page_objects = req.pdf.pages.map(function(page) {
    return page._object;
  });
  res.json(page_objects);
});

/** GET /files/:name/pages/:page_number
In the user interface, page numbers are 1-based.
In the pdf representation, they are 0-based.
*/
R.get(/\/pages\/(\d+)$/, function(req, res) {
  var document_canvas = pdfi_graphics.renderPage(req.page);
  res.json(document_canvas);
});

/** GET /files/:name/pages/:page_number/contents
*/
R.get(/\/contents$/, function(req, res) {
  var Contents = req.page.joinContents('\n'); // returns a string
  res.json({Contents: Contents});
});

module.exports = function(req, res) {
  // req.pdf is already set on all incoming requests
  var m = req.url.match(/\/pages\/(\d+)(\/|\?|$)/);
  if (m) {
    // set req.page if there is a page specified
    var page_number = parseInt(m[1], 10);
    // subtract one to change indexing from 1-based to 0-based
    req.page = req.pdf.pages[page_number - 1];
  }
  R.route(req, res);
};
