(function (global) {
  'use strict';
  var DB = 'mentria-push', STORE = 'pending', VER = 1;
  function open() {
    return new Promise(function (resolve, reject) {
      var req = global.indexedDB.open(DB, VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'scheduleId' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  global.MentriaPushDB = {
    putPending: function (spec) { return tx('readwrite', function (s) { s.put(spec); }); },
    getPending: function (id) { return tx('readonly', function (s) { return s.get(id); }); },
    deletePending: function (id) { return tx('readwrite', function (s) { s.delete(id); }); },
    allPending: function () { return tx('readonly', function (s) { return s.getAll(); }); }
  };
})(typeof self !== 'undefined' ? self : this);
