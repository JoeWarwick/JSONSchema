// Type declarations for CSS modules so TypeScript accepts imports like `import styles from './foo.module.css'`.
// Placed in `project/app/types` which is part of the project source tree and picked up by TS if `include` covers **/*.d.ts

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css' {
  // Non-module CSS imported as an object of class names (fallback). Adjust as needed.
  const classes: { readonly [key: string]: string };
  export default classes;
}
