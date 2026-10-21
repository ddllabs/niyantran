import { useEffect, useRef, useState } from 'react';
import { fetchInvoiceHtml } from '../../lib/billing.js';

export default function InvoicePreview({ invoiceId,onClose }) {
  const dialogRef=useRef(null);
  const pressedOutside=useRef(false);
  function outside(event) {
    if (event.target !== event.currentTarget) return false;
    const rect=event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  const [html,setHtml]=useState(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const dialog=dialogRef.current;
    const trigger=document.activeElement;
    dialog.showModal();
    return()=>{dialog.close();if(trigger?.isConnected) trigger.focus({preventScroll:true});};
  },[]);
  useEffect(()=>{
    let live=true;
    fetchInvoiceHtml(invoiceId).then(value=>{if(live)setHtml(value);}).catch(()=>{if(live)setError('Invoice could not be loaded. Close and try again.');});
    return()=>{live=false;};
  },[invoiceId]);
  return <dialog ref={dialogRef} className="billing-invoice-dialog" aria-label="Invoice preview"
    onPointerDown={event=>{pressedOutside.current=event.button === 0 && outside(event);}}
    onPointerCancel={()=>{pressedOutside.current=false;}}
    onClick={event=>{const dismiss=pressedOutside.current && outside(event);pressedOutside.current=false;if(dismiss)onClose();}}
    onCancel={event=>{event.preventDefault();onClose();}}>
    <div className="billing-invoice-head"><h3>Invoice</h3><button type="button" className="billing-invoice-close" aria-label="Close invoice" onClick={onClose}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
    {error ? <p role="alert">{error}</p> : html === null ? <p role="status">Loading invoice…</p> : <iframe title="Printable invoice" srcDoc={html} sandbox="allow-scripts allow-modals"/>}
  </dialog>;
}
