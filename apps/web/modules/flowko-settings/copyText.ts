// Flowko U29d: copy a text to the clipboard on the owner's click (U3). Answers whether it worked; never logs the
// text (it is an invite link, a credential for 7 days) and never reports success before the write settled (Cal's
// useCopy logs the text when there is no clipboard and its fetchAndCopyToClipboard reports success early).
export async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
