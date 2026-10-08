import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export default function V6Dialog({ children, titleId, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={ref} className="detail-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}><button className="dialog-x icon-button" aria-label="Close dialog" onClick={onClose}><X /></button>{children}</dialog>;
}
