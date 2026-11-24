// Ticket drag and drop, built on Atlassian's Pragmatic drag and drop.
// While a ticket is dragged, the page scrolls when the pointer nears the top or bottom edge,
// and wide grids (Board, Week plan) scroll sideways near their left or right edge.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { autoScrollForElements, autoScrollWindowForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';

const KIND = 'sidequest-ticket';
type TicketData = { kind: typeof KIND; key: string };
const isTicket = (d: Record<string | symbol, unknown>): d is TicketData => d.kind === KIND && typeof d.key === 'string';

/** Makes an element draggable as a ticket. Returns whether it is being dragged right now. */
export function useDraggableTicket(ref: RefObject<HTMLElement | null>, key: string) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return draggable({
      element,
      getInitialData: (): TicketData => ({ kind: KIND, key }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [ref, key]);
  return dragging;
}

/** The key of the ticket being dragged anywhere on the page, or null. */
export function useDraggedTicket() {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => monitorForElements({
    canMonitor: ({ source }) => isTicket(source.data),
    onDragStart: ({ source }) => setKey(isTicket(source.data) ? source.data.key : null),
    onDrop: () => setKey(null),
  }), []);
  return key;
}

/** Scrolls the window, and the given wide container, while a ticket is dragged near their edges. */
export function useDragAutoScroll(ref?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const canScroll = ({ source }: { source: { data: Record<string | symbol, unknown> } }) => isTicket(source.data);
    const element = ref?.current;
    return combine(
      autoScrollWindowForElements({ canScroll }),
      ...(element ? [autoScrollForElements({ element, canScroll })] : []),
    );
  }, [ref]);
}

/**
 * A drop area for tickets. Gets the `over` class while a ticket hovers it.
 * `onDropKey` always sees the latest props, so callers can pass an inline function.
 */
export function DropZone({ as: Tag = 'div', className = '', style, label, onDropKey, children }: {
  as?: 'div' | 'section'; className?: string; style?: CSSProperties; label?: string;
  onDropKey: (key: string) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = useRef(onDropKey);
  onDrop.current = onDropKey;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isTicket(source.data),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source }) => {
        setOver(false);
        if (isTicket(source.data)) onDrop.current(source.data.key);
      },
    });
  }, []);
  return (
    <Tag ref={ref as never} className={`${className}${over ? ' over' : ''}`} style={style} aria-label={label}>
      {children}
    </Tag>
  );
}
