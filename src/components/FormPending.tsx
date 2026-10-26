"use client";

import { useFormStatus } from "react-dom";
import { TopLoadingBar } from "./TopLoadingBar";

/** Put inside a next/form `Form`. Shows the top loading line at once when the form is submitted (like LinkPending). */
export function FormPending() {
  const { pending } = useFormStatus();
  return pending ? <TopLoadingBar /> : null;
}
