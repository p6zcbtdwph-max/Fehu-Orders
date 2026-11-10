// React 19 hat den globalen JSX-Namespace entfernt. Die App nutzt `JSX.Element`
// als Rückgabetyp in fast allen Komponenten, deshalb hier wieder global verfügbar.
import type { JSX as ReactJSX } from 'react'

declare global {
  namespace JSX {
    type Element = ReactJSX.Element
    type IntrinsicElements = ReactJSX.IntrinsicElements
  }
}
