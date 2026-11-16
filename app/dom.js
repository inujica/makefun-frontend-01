// The DOM layer: el() builds a node, setText()/patch() keep it correct, virtualList() keeps only the
// rows in view. No framework — this file is on the first load, so it stays short and dull.

const asText = (value) => (value == null ? '' : String(value));

/** Create an element. props are attributes, except class/text/style/dataset/on<event> and the live
 *  properties value, checked, hidden, disabled and selected; a null or false value drops one. */
export function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) patch(node, props);
  if (children != null) {
    for (const child of [].concat(children).flat()) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : asText(child));
    }
  }
  return node;
}

/** Write text only when it changed: a ticking countdown that would write the same string must not
 *  touch the DOM at all. */
export function setText(node, value) {
  const next = asText(value);
  if (node.textContent !== next) node.textContent = next;
  return node;
}

/** Apply only the props that changed and leave the children alone: this is how a view refreshes itself
 *  (revalidate, then patch the few fields that moved) instead of rebuilding the subtree. Listeners are
 *  added, never replaced, so pass props to patch() while building, not to re-bind. */
export function patch(node, props) {
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (key === 'class') {
      if (node.className !== asText(value)) node.className = asText(value);
    } else if (key === 'text') {
      setText(node, value);
    } else if (key === 'style') {
      for (const name of Object.keys(value)) node.style.setProperty(name, asText(value[name]));
    } else if (key === 'dataset') {
      for (const name of Object.keys(value)) node.dataset[name] = asText(value[name]);
    } else if (key.slice(0, 2) === 'on' && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'value' || key === 'checked' || key === 'hidden' || key === 'disabled' || key === 'selected') {
      node[key] = value;
    } else if (value == null || value === false) {
      node.removeAttribute(key);
    } else {
      node.setAttribute(key, asText(value));
    }
  }
  return node;
}

/** Placeholder blocks for the moment between a route starting and its data arriving. */
export function skeleton(count = 4) {
  const box = el('div', { 'aria-hidden': 'true' });
  while (count--) box.append(el('div', { class: 'skel' }));
  return box;
}

/** Render only the rows in view: a spacer of rows.length * rowHeight keeps the scrollbar honest, and
 *  one window div, moved with a translate, holds the visible rows plus `overscan` each side — so a
 *  6000-row leaderboard is twenty nodes. The row height is read from the container's --rowh custom
 *  property, so the stylesheet keeps ownership of it and a breakpoint change is picked up on resize. */
export function virtualList(container, rows, renderRow, options = {}) {
  const measure = () => {
    const declared = parseFloat(getComputedStyle(container).getPropertyValue('--rowh'));
    return declared > 0 ? declared : options.rowHeight || 64;
  };
  let rowHeight = measure();
  const overscan = options.overscan == null ? 5 : options.overscan;
  const spacer = el('div', { class: 'vspacer', 'aria-hidden': 'true' });
  const windowBox = el('div', { class: 'vwin' });
  container.classList.add('vlist');
  container.replaceChildren(spacer, windowBox);

  let list = rows || [];
  let first = -1;
  let last = -1;
  let frame = 0;

  function paint() {
    frame = 0;
    const height = container.clientHeight || 480;
    const top = container.scrollTop;
    const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
    const end = Math.min(list.length, Math.ceil((top + height) / rowHeight) + overscan);
    if (start === first && end === last) return;
    first = start;
    last = end;
    windowBox.style.transform = `translateY(${start * rowHeight}px)`;
    const batch = document.createDocumentFragment();
    for (let i = start; i < end; i++) batch.append(renderRow(list[i], i));
    windowBox.replaceChildren(batch);
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const onScroll = () => schedule();
  const onResize = () => {
    rowHeight = measure();
    spacer.style.height = `${list.length * rowHeight}px`;
    first = -1;
    schedule();
  };

  container.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  spacer.style.height = `${list.length * rowHeight}px`;
  paint();

  return {
    update(next) {
      list = next || [];
      spacer.style.height = `${list.length * rowHeight}px`;
      first = -1;
      last = -1;
      paint();
    },
    destroy() {
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
