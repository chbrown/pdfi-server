var _ = require('lodash');
var url = require('url');
var lexing = require('lexing');
var Router = require('regex-router');

var pdfi_models = require('pdfi/models');
var pdfi_font = require('pdfi/font');
var pdfi_graphics = require('pdfi/graphics');
var pdfi_parser_states = require('pdfi/parsers/states');

var R = new Router(function(req, res) {
  res.status(404).die('No resource at: ' + req.url);
});

/** GET /files/:name/objects
List all objects in a PDF
*/
R.get(/\/objects$/, function(req, res) {
  // req.pdf.trailer.Size
  // req.pdf.cross_references
  res.die('Not yet implemented');
});

/** GET /files/:name/objects/:object_number?generation:number=0
*/
R.get(/\/objects\/(\d+)(\?|$)/, function(req, res) {
  if (pdfi_models.ContentStream.isContentStream(req.object)) {
    var content_stream = new pdfi_models.ContentStream(req.pdf, req.object);
    req.object.buffer = content_stream.buffer;
  }
  res.json(req.object);
});

/** GET /files/:name/objects/:object_number/content-stream?generation:number=0
*/
R.get(/\/content-stream/, function(req, res) {
  var content_stream = new pdfi_models.ContentStream(req.pdf, req.object);

  // TODO: wrap in a try-catch
  var stream_string = content_stream.buffer.toString('binary');
  var stream_string_iterable = new lexing.StringIterator(stream_string);
  var operations = new pdfi_parser_states.CONTENT_STREAM(stream_string_iterable, 1024).read();

  var spans = pdfi_graphics.renderContentStreamText(content_stream);

  res.json({operations: operations, spans: spans});
});

/** GET /files/:name/objects/:object_number/font?generation:number=0
*/
R.get(/\/font/, function(req, res) {
  var font_Model = new pdfi_models.Model(req.pdf, req.object);
  var font = pdfi_font.Font.fromModel(font_Model);
  res.json({encoding: font.encoding});
});

module.exports = function(req, res) {
  // req.pdf is already set on all incoming requests
  var m = req.url.match(/\/objects\/(\d+)(\/|\?|$)/);
  // ANY /files/:name/objects/:object_number*?generation:number=0
  if (m) {
    // set req.object if there is an object specified
    var urlObj = url.parse(req.url, true);
    var object_number = parseInt(m[1], 10);
    var generation_number = parseInt(urlObj.query.generation || 0, 10);
    // getObject returns the cached object from the pdfi -- don't modify it!
    var object = req.pdf.getObject(object_number, generation_number);
    // clone the original object, so that we can modify it later without
    // manipulating (too much) of the cached object in the pdfi.PDF instance
    req.object = _.clone(object);
  }
  R.route(req, res);
};
