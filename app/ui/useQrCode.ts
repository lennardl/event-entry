"use client";

import { useEffect, useState } from "react";

export function useQrCode(value: string, width = 420) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (!value) return void queueMicrotask(() => setQr(""));
    import("qrcode").then((module) => module.toDataURL(value, { width, margin: 2, color: { dark: "#17213A", light: "#FFFFFF" } })).then(setQr);
  }, [value, width]);
  return qr;
}
