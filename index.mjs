import { parse, fragment, serialize } from '@begin/parse5'
import isCustomElement from './lib/is-custom-element.mjs'
import { encode, decode } from './lib/transcode.mjs'
let count = 0
function getID() {
  return `_${count++}`.toString(16)
}

export default function Enhancer(options={}) {
  const {
    initialState={},
    elements=[],
    scriptTransforms=[],
    styleTransforms=[],
  } = options
  const store = Object.assign({}, initialState)

  return function html(strings, ...values) {
    const doc = parse(render(strings, ...values))
    const html = doc.childNodes.find(node => node.tagName === 'html')
    const body = html.childNodes.find(node => node.tagName === 'body')
    const { usedElements } = processCustomElements(body, elements, store)
    const templateNames = Object.keys(elements)
      .filter(element => usedElements.includes(element))
    const templates = fragment(templateNames
      .map(name => template({
          name,
          elements,
          store,
          scriptTransforms,
          styleTransforms
        }))
        .join('')
    )
    addTemplateTags(body, templates)
    addScriptStripper(body)
    return serialize(doc).replace(/__b_\d+/g, '')
  }
}

function render(strings, ...values) {
  const collect = []
  for (let i = 0; i < strings.length - 1; i++) {
    collect.push(strings[i], encode(values[i]))
  }
  collect.push(strings[strings.length - 1])
  return collect.join('')
}

function processCustomElements(node, elements, store) {
  const authoredTemplates = []
  const usedElements = []
  const find = (node) => {
    for (const child of node.childNodes) {
      if (isCustomElement(child.tagName)) {
        const slotChildren = child.childNodes.filter(
          n => n.attrs?.find(a => a.name === 'slot')
            ? n
            : null
        )
        if (slotChildren.length) {
          const id = child.attrs.find(attr => attr.name === 'id')?.value
          if(!id) {
            child.attrs.push({ name: 'id', value: getID() })
          }
          slots.forEach(
            node => authoredContentTemplates.push(template({ name: id })).childNodes = slots)
          )
        }
        usedElements.push(child.tagName)
        const template = expandTemplate(child, elements, store)
        fillSlots(child, template)
      }
      if (child.childNodes) find(child)
    }
  }
  find(node)
  return {
    authoredTemplates,
    usedElements
  }
}

function expandTemplate(node, elements, store) {
  const frag = renderTemplate({
    name: node.tagName,
    elements,
    attrs: node.attrs,
    store
  }) || ''
  for (const node of frag.childNodes) {
    if (node.nodeName === 'script') {
      frag.childNodes.splice(frag.childNodes.indexOf(node), 1)
    }
    if (node.nodeName === 'style') {
      frag.childNodes.splice(frag.childNodes.indexOf(node), 1)
    }
  }
  return frag
}

function renderTemplate({ name, elements, attrs=[], store={} }) {
  attrs = attrs ? attrsToState(attrs) : {}
  const state = { attrs, store }
  try {
    return fragment(elements[name]({ html: render, state }))
  }
  catch(err) {
    throw new Error(`Issue rendering template for ${name}.\n${err.message}`)
  }
}

function attrsToState(attrs=[], obj={}) {
  [...attrs].forEach(attr => obj[attr.name] = decode(attr.value))
  return obj
}

function fillSlots(node, template) {
  const slots = findSlots(template)
  const inserts = findInserts(node)
  const usedSlots = []
  for (let i=0; i<slots.length; i++) {
    let hasSlotName = false
    const slot = slots[i]
    const slotAttrs = slot.attrs || []

    const slotAttrsLength = slotAttrs.length
    for (let i=0; i < slotAttrsLength; i++) {
      const attr = slotAttrs[i]
      if (attr.name === 'name') {
        hasSlotName = true
        const slotName = attr.value
        const insertsLength = inserts.length
        for (let i=0; i < insertsLength; i ++) {
          const insert = inserts[i]
          const insertAttrs = insert.attrs || []

          const insertAttrsLength = insertAttrs.length
          for (let i=0; i < insertAttrsLength; i++) {
            const attr = insertAttrs[i]
            const insertSlot = attr.value

            if (insertSlot === slotName) {
              const slotParentChildNodes = slot.parentNode.childNodes
              slotParentChildNodes.splice(
                slotParentChildNodes
                  .indexOf(slot),
                1,
                insert
              )
              usedSlots.push(slot)
            }
          }
        }
      }
    }

    if (!hasSlotName) {
      slot.childNodes.length = 0
      const children = node.childNodes
        .filter(n => !inserts.includes(n))
      const slotParentChildNodes = slot.parentNode.childNodes
      slotParentChildNodes.splice(
        slotParentChildNodes
          .indexOf(slot),
        1,
        ...children
      )
    }
  }

  const unusedSlots = slots.filter(slot => !usedSlots.includes(slot))
  replaceSlots(template, unusedSlots)
  const nodeChildNodes = node.childNodes
  nodeChildNodes.splice(
    0,
    nodeChildNodes.length,
    ...template.childNodes
  )
}

function findSlots(node) {
  const elements = []
  const find = (node) => {
    for (const child of node.childNodes) {
      if (child.tagName === 'slot') {
        elements.push(child)
      }
      if (!isCustomElement(child.tagName) &&
        child.childNodes) {
        find(child)
      }
    }
  }
  find(node)
  return elements
}

function findInserts(node) {
  const elements = []
  const find = (node) => {
    for (const child of node.childNodes) {
      const attrs = child.attrs
      if (attrs) {
        for (let i=0; i < attrs.length; i++) {
          if (attrs[i].name === 'slot') {
            elements.push(child)
          }
        }
      }
      if (!isCustomElement(child.tagName) &&
          child.childNodes) {
        find(child)
      }
    }
  }
  find(node)
  return elements
}

function replaceSlots(node, slots) {
  slots.forEach(slot => {
    const value = slot.attrs.find(attr => attr.name === 'name')?.value
    const name = 'slot'
    const slotChildren = slot.childNodes.filter(
      n => {
        return !n.nodeName.startsWith('#')
      }
    )
    // If this is a named slot
    if (value) {
      if (!slotChildren.length) {
        // Only has text nodes
        const wrapperSpan = {
          nodeName: 'span',
          tagName: 'span',
          attrs: [{ value, name }],
          namespaceURI: 'http://www.w3.org/1999/xhtml',
          childNodes: []
        }

        wrapperSpan.childNodes = wrapperSpan.childNodes.concat(slot.childNodes)
        slot.childNodes.length = 0
        slot.childNodes.push(wrapperSpan)
      }
      else if (slotChildren.length > 1) {
         // Has multiple children
         const wrapperDiv = {
          nodeName: 'div',
          tagName: 'div',
          attrs: [{ value, name }],
          namespaceURI: 'http://www.w3.org/1999/xhtml',
          childNodes: []
        }

        wrapperDiv.childNodes = wrapperDiv.childNodes.concat(slot.childNodes)
        slot.childNodes.length = 0
        slot.childNodes.push(wrapperDiv)
      }
      else {
        slotChildren[0].attrs.push({ value, name })
      }
    }
    const slotParentChildNodes = slot.parentNode.childNodes
    slotParentChildNodes.splice(
      slotParentChildNodes
        .indexOf(slot),
      1,
      ...slot.childNodes
    )
  })
  return node
}

function applyScriptTransforms({ node, scriptTransforms }) {
  const attrs = node.attrs || []
  const raw = node.childNodes[0].value
  let out = raw
  scriptTransforms.forEach(transform => {
    out = transform({ attrs, raw: out, tagName: node.tagName })
  })
  if (!out.length) return
  node.childNodes[0].value = out
  return node
}

function applyStyleTransforms({ nodes, styleTransforms }) {
  nodes.forEach(node => {
    const attrs = node.attrs || []
    const raw = node.childNodes[0].value
    let out = raw
    styleTransforms.forEach(transform => {
      out = transform({ attrs, raw: out, tagName: node.tagName })
    })
    if (!out.length) return
    node.childNodes[0].value = out
  })
  return nodes
}

function applyTransforms() {

}

function template({ name, elements, store, scriptTransforms, styleTransforms }) {
  const frag = renderTemplate({ name, elements, store })
  const script = frag.childNodes.find(n => n.nodeName === 'script')
  const style = frag.childNodes.filter(n => n.nodeName === 'style')

  if (script && scriptTransforms.length) {
    const scriptNode = applyScriptTransforms({ node: script, scriptTransforms })
    script.childNodes[0].value = scriptNode.childNodes[0].value
  }

  if (style.length && styleTransforms.length) {
    const styleNodes = applyStyleTransforms({ nodes: style, styleTransforms })
    style.forEach((s, i) => {
        s.childNodes[0].value = styleNodes[i].childNodes[0].value
    })
  }

  return `
<template id="${name}-template">
  ${serialize(frag)}
</template>
  `
}

function addTemplateTags(body, templates) {
 body.childNodes.push(...templates.childNodes)
}

function addScriptStripper(body) {
 const stripper = fragment(`<script>Array.from(document.getElementsByTagName("template")).forEach(t => t.content.lastElementChild && 'SCRIPT' === t.content.lastElementChild.nodeName?document.body.appendChild(t.content.lastElementChild):'')</script>`)
 body.childNodes.push(...stripper.childNodes)
}
