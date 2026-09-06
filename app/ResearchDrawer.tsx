"use client";
import {useEffect,useRef,type ReactNode} from "react";

export function ResearchDrawer({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const trigger=document.activeElement as HTMLElement|null;ref.current?.showModal();const overflow=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=overflow;trigger?.focus();};},[]);
  return <dialog ref={ref} className="rb-dialog rb-trade-drawer" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right)onClose();}}}>
    <header className="rb-drawer-heading"><div><p className="rb-eyebrow">CURRENT ENGINE · SAVED RESEARCH</p><h2>{title}</h2></div><button aria-label="Close research trades" onClick={onClose}>Close</button></header>
    {children}
  </dialog>;
}
