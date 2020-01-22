// @flow
import * as css from 'css'
import { replaceClassNames } from './replace-class-names'
import {
  getClassNamesFromNodes,
  isReactElement,
  isEmotionCssPropElementType,
  isEmotionCssPropEnzymeElement,
  isDOMElement,
  getStylesFromClassNames,
  getStyleElements,
  getKeys,
  flatMap,
  isPrimitive,
  hasIntersection
} from './utils'

function getNodes(node, nodes = []) {
  if (Array.isArray(node)) {
    for (let child of node) {
      getNodes(child, nodes)
    }
    return nodes
  }

  if (node.children) {
    for (let child of node.children) {
      getNodes(child, nodes)
    }
  }

  if (typeof node === 'object') {
    nodes.push(node)
  }

  return nodes
}

function copyProps(src, target) {
  return Object.defineProperties(src, {
    ...Object.getOwnPropertyDescriptors(target)
  })
}

function deepTransform(node, transform) {
  if (Array.isArray(node)) {
    return node.map(child => deepTransform(child, transform))
  }

  const transformed: any = transform(node)

  if (transformed !== node) {
    if (transformed.props) {
      copyProps(transformed, {
        props: Object.entries(transformed.props).reduce(
          (props, [key, value]) =>
            Object.assign(props, {
              [key]: deepTransform(value, transform)
            }),
          {}
        )
      })
    }
    if (transformed.children) {
      return copyProps(transformed, {
        // flatMap to allow a child of <A><B /><C /></A> to be transformed to <B /><C />
        children: flatMap(
          (deepTransform(transformed.children, transform): any),
          id => id
        )
      })
    }
  }

  return transformed
}

function getPrettyStylesFromClassNames(
  classNames: Array<string>,
  elements: Array<HTMLStyleElement>
) {
  const styles = getStylesFromClassNames(classNames, elements)

  let prettyStyles
  try {
    prettyStyles = css.stringify(css.parse(styles))
  } catch (e) {
    console.error(e)
    throw new Error(`There was an error parsing the following css: "${styles}"`)
  }
  return prettyStyles
}

export type Options = {
  classNameReplacer?: (className: string, index: number) => string,
  DOMElements?: boolean
}

function filterEmotionProps(props = {}) {
  const {
    css,
    __EMOTION_TYPE_PLEASE_DO_NOT_USE__,
    __EMOTION_LABEL_PLEASE_DO_NOT_USE__,
    ...rest
  } = props

  rest.css = 'unknown styles'

  return rest
}

function isShallowEnzymeElement(element: any, classNames: string[]) {
  const delimiter = ' '
  const childClassNames = flatMap(element.children || [], ({ props = {} }) =>
    (props.className || '').split(delimiter)
  ).filter(Boolean)
  return !hasIntersection(classNames, childClassNames)
}

const createConvertEmotionElements = (
  keys: string[],
  printer: *,
  isTransformed
) => (node: any) => {
  if (isTransformed(node) || isPrimitive(node)) {
    return node
  }
  if (isEmotionCssPropEnzymeElement(node)) {
    const cssClassNames = (node.props.css.name || '').split(' ')
    const expectedClassNames = flatMap(cssClassNames, cssClassName =>
      keys.map(key => `${key}-${cssClassName}`)
    )
    // if this is a shallow element, we need to manufacture the className
    // since the underlying component is not rendered.
    if (isShallowEnzymeElement(node, expectedClassNames)) {
      const className = [node.props.className]
        .concat(expectedClassNames)
        .filter(Boolean)
        .join(' ')
      const emotionType = node.props.__EMOTION_TYPE_PLEASE_DO_NOT_USE__
      // emotionType will be a string for DOM elements
      const type =
        typeof emotionType === 'string' ? emotionType : emotionType.name
      return {
        ...node,
        props: filterEmotionProps({
          ...node.props,
          className
        }),
        type
      }
    } else {
      return node.children
    }
  }
  if (isEmotionCssPropElementType(node)) {
    return {
      ...node,
      props: filterEmotionProps(node.props),
      type: node.props.__EMOTION_TYPE_PLEASE_DO_NOT_USE__
    }
  }
  if (isReactElement(node)) {
    return copyProps({}, node)
  }
  return node
}

function clean(node: any, classNames: string[]) {
  if (Array.isArray(node)) {
    for (const child of node) {
      clean(child, classNames)
    }
    return
  }
  if (node.children) {
    for (const child of node.children) {
      clean(child, classNames)
    }
  }
  if (node.props) {
    const { className } = node.props
    if (!className) {
      // if it's empty, remove it
      delete node.props.className
    } else {
      const hasKnownClass = hasIntersection(className.split(' '), classNames)
      if (hasKnownClass) {
        delete node.props.css
      }
    }
  }
}

export function createSerializer({
  classNameReplacer,
  DOMElements = true
}: Options = {}) {
  const cache = new WeakSet()
  const isTransformed = (node: any) => cache.has(node)
  function print(val: *, printer: Function) {
    const isNestedPrint = isTransformed(val)
    const elements = getStyleElements()
    const keys = getKeys(elements)
    const convertEmotionElements = createConvertEmotionElements(
      keys,
      printer,
      isTransformed
    )
    const converted = deepTransform(val, convertEmotionElements)
    const nodes = getNodes(converted)
    nodes.forEach(cache.add, cache)
    const classNames = getClassNamesFromNodes(nodes)
    const styles = getPrettyStylesFromClassNames(classNames, elements)
    clean(converted, classNames)
    const printedVal = printer(converted)
    nodes.forEach(cache.delete, cache)
    return isNestedPrint
      ? printedVal
      : replaceClassNames(
          classNames,
          styles,
          printedVal,
          keys,
          classNameReplacer
        )
  }

  return {
    test(val: *) {
      return (
        val &&
        (!isTransformed(val) &&
          (isReactElement(val) || (DOMElements && isDOMElement(val))))
      )
    },
    print
  }
}

export const { print, test } = createSerializer()