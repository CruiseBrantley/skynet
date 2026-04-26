/**
 * Jest setup file to suppress Node.js experimental WebStorage warnings.
 * This removes the global localStorage and sessionStorage which trigger
 * the "--localstorage-file was provided without a valid path" warning
 * during Jest teardown in Node 22+.
 */
if (global.localStorage) {
  delete global.localStorage
}
if (global.sessionStorage) {
  delete global.sessionStorage
}
