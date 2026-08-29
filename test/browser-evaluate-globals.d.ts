/*
 * Playwright evaluates these callbacks in a browser even though TypeScript
 * checks the surrounding .mjs in Node. Locator/evaluate generics intentionally
 * expose only Element/EventTarget, while the fixture DOM is known HTML and the
 * callbacks also attach short-lived test sentinels. Keep that dynamic surface
 * confined to the test checker; production source is checked separately.
 */
declare global {
  interface EventTarget { [testProperty: string]: any; }
  interface Node { [testProperty: string]: any; }
  interface Element { [testProperty: string]: any; }
  interface Window { [testProperty: string]: any; }
  interface FileReader { [testProperty: string]: any; }
  interface CSSStyleDeclaration { webkitBackdropFilter: string; }
  interface Error {
    code?: string;
    status?: number;
    statusCode?: number;
  }

  function queueMicrotask(callback: (...args: any[]) => void): void;
  var wireNotice: any;
  var RabbitholeUiTest: any;
}

declare module "node:net" {
  interface Server {
    /** Test servers in this repository always bind a TCP loopback address. */
    address(): AddressInfo;
  }
}

declare module "playwright" {
  interface Page {
    /** Some fixtures inject synthetic page events through EventEmitter. */
    emit(event: string | symbol, ...args: any[]): boolean;
  }
}

export {};
