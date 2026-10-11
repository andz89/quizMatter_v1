import { Fragment } from "react";
import { isWebLink } from "@/lib/schema";

// Anything from http:// or https:// up to the next space. split() keeps these at the odd places of its list.
const LINK_PATTERN = /(https?:\/\/\S+)/;
// Punctuation that ends a sentence right after a link ("see https://site.com.") isn't part of the link.
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/** Plain text where the pasted links are clickable (a new tab). Line breaks show if the parent keeps them. */
export function LinkifiedText({ text }: { text: string }) {
  return text.split(LINK_PATTERN).map((part, index) => {
    if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;
    const link = part.replace(TRAILING_PUNCTUATION, "");
    if (!isWebLink(link)) return <Fragment key={index}>{part}</Fragment>;
    return (
      <Fragment key={index}>
        <a href={link} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline">
          {link}
        </a>
        {part.slice(link.length)}
      </Fragment>
    );
  });
}
