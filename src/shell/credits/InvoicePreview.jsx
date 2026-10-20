import { useEffect, useRef, useState } from 'react';
import { fetchInvoiceHtml } from '../../lib/billing.js';

export default function InvoicePreview({ invoiceId,onClose }) {
  const dialogRef=useRef(null);
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
  return <dialog ref={dialogRef} className="billing-invoice-dialog" aria-label="Invoice preview" onCancel={event=>{event.preventDefault();onClose();}}>
    <div className="billing-invoice-head"><h3>Invoice</h3><button type="button" className="billing-secondary" onClick={onClose}>Close invoice</button></div>
    {error ? <p role="alert">{error}</p> : html === null ? <p role="status">Loading invoice…</p> : <iframe title="Printable invoice" srcDoc={html} sandbox="allow-scripts allow-modals"/>}
  </dialog>;
}
