/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/@babel/runtime@7.21.0/helpers/esm/defineProperty.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
function o(e){"@babel/helpers - typeof";return o=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(r){return typeof r}:function(r){return r&&typeof Symbol=="function"&&r.constructor===Symbol&&r!==Symbol.prototype?"symbol":typeof r},o(e)}function i(e,r){if(o(e)!=="object"||e===null)return e;var t=e[Symbol.toPrimitive];if(t!==void 0){var n=t.call(e,r);if(o(n)!=="object")return n;throw new TypeError("@@toPrimitive must return a primitive value.")}return(r==="string"?String:Number)(e)}function f(e){var r=i(e,"string");return o(r)==="symbol"?r:String(r)}function u(e,r,t){return r=f(r),r in e?Object.defineProperty(e,r,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[r]=t,e}export{u as default};
//# sourceMappingURL=/sm/ac4c33d5cf28fb12670a5204e7d3ba8c70ca6ffb95bf775f7ba7f6440812d8fc.map