var _ = require('lodash');
var async = require('async');
var path = require('path');
var fs = require('fs');
var url = require('url');
var lexing = require('lexing');
var formidable = require('formidable');

var logger = require('loge');
var Router = require('regex-router');

var pdfi = require('pdfi');
var pdfi_PDF = require('pdfi/PDF');
var pdfi_models = require('pdfi/models');
var pdfi_font = require('pdfi/font');
var pdfi_parser_states = require('pdfi/parsers/states');

pdfi.setLoggerLevel(logger.level);

var files_dirpath = process.env.UPLOADS;

var R = new Router(function(req, res) {
  res.status(404).die('No resource at: ' + req.url);
});

/** GET /files
List uploaded files
*/
R.get(/^\/files$/, function(req, res) {
  fs.readdir(files_dirpath, function(err, filenames) {
    if (err) return res.die(err);
    filenames = filenames.filter(function(filename) {
      // stupid Mac OS X with your .DS_Store files
      return !filename.match(/^\./);
    });

    async.map(filenames, function(filename, callback) {
      var filepath = path.join(files_dirpath, filename);
      fs.stat(filepath, function(err, stats) {
        callback(err, {name: filename, size: stats.size});
      });
    }, function(err, files) {
      if (err) return res.die(err);
      res.json(files);
    });
  });
});

/** POST /files
Upload new file
*/
R.post(/^\/files$/, function(req, res) {
  /** formidable.IncomingForm#parse(request: http.IncomingMessage,
                                    callback: (...))

  The `files` object in the callback is keyed by the field name used by the
  client.

  Depending on the whether the client sent one or multiple files with
  the same field name, the `files` object's values will be a File, or an Array
  of Files. Not the API design I would have chosen, but easy enough to coalesce
  to an Array.

  Example `files` object (where the client sent a single file on with the field
  name "file":

      {
        "file": {
          "size": 899791,
          "path": "/var/folders/m8/cq7z9jxj0774qz_3yg0kw5k40000gn/T/upload_c93ff63b9905c00ca7c8b778dab527f0",
          "name": "5th-cat.jpg",
          "type": "application/pdf",
          "mtime": "2015-02-13T11:34:47.811Z"
        }
      }
  */
  new formidable.IncomingForm({multiples: true})
  .on('fileBegin', function(name, file) {
    file.path = path.join(files_dirpath, file.name);
    logger.debug('fileBegin', name, file);
  })
  .parse(req, function(err, fields, files) {
    if (err) return res.die(err);
    var file = files.file || {};
    res.json({name: file.name, size: file.size, type: file.type, lastModifiedDate: file.lastModifiedDate});
  });
});

// per-file routes

var _pdf_cache = {};

var FileR = new Router(function(req, res) {
  res.status(404).die('No resource at: ' + req.url);
});

/** GET /files/:name/*
Set req.pdf for all sub-routes, and turn over to FileR router.
*/
R.get(/^\/files\/([^\/]+)($|\/)/, function(req, res, m) {
  var name = decodeURIComponent(m[1]);
  try {
    if (!(name in _pdf_cache)) {
      var filepath = path.join(files_dirpath, name);
      _pdf_cache[name] = pdfi_PDF.open(filepath);
    }
    req.pdf = _pdf_cache[name];
  }
  catch (error) {
    return res.die(error);
  }
  FileR.route(req, res);
});

/** GET /files/:name
*/
FileR.get(/^\/files\/([^\/]+)$/, function(req, res, m) {
  res.json({
    // Angular model updating wants the name here too:
    name: decodeURIComponent(m[1]),
    size: req.pdf.size,
    trailer: _.omit(req.pdf.trailer._object, 'ID'), // who needs the ID?
    cross_references: req.pdf.cross_references,
  });
});

/** GET /files/:name/document
*/
FileR.get(/^\/files\/([^\/]+)\/document$/, function(req, res) {
  var section_names = ['col1', 'col2'];
  var document = req.pdf.getDocument(section_names);
  res.json(document);
});

/** GET /files/:name/pages
*/
FileR.get(/^\/files\/([^\/]+)\/pages$/, function(req, res) {
  var raw_pages = req.pdf.pages.map(function(page) {
    return page._object;
  });
  res.json(raw_pages);
});

/** GET /files/:name/pages/:page_number

In the user interface, page numbers are 1-based. In the pdf representation,
they are 0-based.
*/
FileR.get(/^\/files\/([^\/]+)\/pages\/(\d+)$/, function(req, res, m) {
  var page_number = parseInt(m[2], 10);

  // subtract one to change indexing from 1-based to 0-based
  var page = req.pdf.pages[page_number - 1];
  var canvas = req.pdf.renderPage(page_number - 1);

  res.json({
    MediaBox: page.MediaBox,
    canvas: canvas,
  });
});

/** GET /files/:name/pages/:page_number/contents
*/
FileR.get(/^\/files\/([^\/]+)\/pages\/(\d+)\/contents$/, function(req, res, m) {
  var page_number = parseInt(m[2], 10);

  // subtract one to change indexing from 1-based to 0-based
  var page = req.pdf.pages[page_number - 1];
  var Contents = page.joinContents('\n'); // returns a string

  res.json({Contents: Contents});
});

/** GET /files/:name/objects */
FileR.get(/^\/files\/([^\/]+)\/objects$/, function(req, res) {
  res.die('Not yet implemented');
});

var ObjectR = new Router(function(req, res) {
  res.status(404).die('No resource at: ' + req.url);
});

/** GET /files/:name/objects/:object_number*?generation:number=0
Set req.object on all sub-routed requests.
*/
FileR.get(/^\/files\/([^\/]+)\/objects\/(\d+)(\/|\?|$)/, function(req, res, m) {
  var urlObj = url.parse(req.url, true);
  var object_number = parseInt(m[2], 10);
  var generation_number = parseInt(urlObj.query.generation || 0, 10);

  // getObject returns the cached object from the pdf lib -- don't modify it!
  req.object = req.pdf.getObject(object_number, generation_number);
  ObjectR.route(req, res);
});

/** GET /files/:name/objects/:object_number?generation:number=0
*/
ObjectR.get(/^\/files\/([^\/]+)\/objects\/(\d+)(\?|$)/, function(req, res) {
  var object = req.object;
  if (pdfi_models.ContentStream.isContentStream(object)) {
    var content_stream = new pdfi_models.ContentStream(req.pdf, object);
    var decoded_object = _.clone(object);
    decoded_object.buffer = content_stream.buffer;
    object = decoded_object;
  }
  res.json(object);
});

/** GET /files/:name/objects/:object_number/content-stream?generation:number=0
*/
ObjectR.get(/\/content-stream/, function(req, res) {
  var object = req.object;

  var content_stream = new pdfi_models.ContentStream(req.pdf, object);
  var decoded_object = _.clone(object);
  decoded_object.buffer = content_stream.buffer;
  object = decoded_object;

  // TODO: wrap in a try-catch
  var stream_string = content_stream.buffer.toString('binary');
  var stream_string_iterable = new lexing.StringIterator(stream_string);
  var operations = new pdfi_parser_states.CONTENT_STREAM(stream_string_iterable, 1024).read();

  return res.json({operations: operations});
});

/** GET /files/:name/objects/:object_number/font?generation:number=0
*/
ObjectR.get(/\/font/, function(req, res) {
  var object = req.object;
  var font_Model = new pdfi_models.Model(req.pdf, object);
  var font = pdfi_font.Font.fromModel(font_Model);
  res.json({Mapping: font.encodingMapping || null});
});

module.exports = function(req, res) {
  logger.debug('%s %s', req.method, req.url);
  R.route(req, res);
};
