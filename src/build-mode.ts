declare const __BOARD_SELF_HOSTED__: boolean | undefined
declare const __BOARD_EXTENSION_PATHS__: readonly string[] | undefined

/** Build-time values. Unknown values fail closed for hosted builds and Node tests. */
export const BOARD_SELF_HOSTED = typeof __BOARD_SELF_HOSTED__ !== 'undefined' && __BOARD_SELF_HOSTED__ === true
export const BOARD_EXTENSION_PATHS: readonly string[] = typeof __BOARD_EXTENSION_PATHS__ !== 'undefined' && Array.isArray(__BOARD_EXTENSION_PATHS__)
  ? __BOARD_EXTENSION_PATHS__.filter(path => typeof path === 'string')
  : []
