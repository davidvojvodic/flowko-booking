import type { NextApiRequest, NextApiResponse } from "next";

import { WEBAPP_URL } from "@calcom/lib/constants";

// Flowko: a relative Cal link may only be slug-character path segments and an optional plain query.
// Anything else (quotes, "<", backslashes, spaces, "." or ".." segments, also percent-encoded) is refused.
const SAFE_RELATIVE_CAL_LINK = /^[a-zA-Z0-9_.%-]+(?:\/[a-zA-Z0-9_.%-]+)*(?:\?[a-zA-Z0-9_.%=&+-]*)?$/;

const isSafeRelativeCalLink = (calLink: string) =>
  SAFE_RELATIVE_CAL_LINK.test(calLink) &&
  !calLink
    .split("?")[0]
    .split("/")
    .some((segment) => /^(?:\.|%2e)+$/i.test(segment));

// Flowko: serialise a value into an inline <script> as a JS string literal. JSON escapes quotes and
// backslashes, and "<" (so "</script>" or "<!--" can't end the script element), U+2028 and U+2029 are
// written as escapes.
const toInlineScriptString = (value: string) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    // Set Content-Type header to text/html
    res.setHeader("Content-Type", "text/html");

    const url = req.query.url;

    // Flowko: a repeated url parameter arrives as an array; only one string is accepted
    if (typeof url !== "string" || !url)
      return res.status(400).json({ message: "Missing URL in query parameters" });

    res.setHeader("Content-Type", "text/html");

    let origin = WEBAPP_URL;
    let calLink = url;

    if (/^https?:\/\//i.test(url)) {
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname.toLowerCase();
        
        if (hostname === "cal.com" || hostname.endsWith(".cal.com")) {
          origin = parsedUrl.origin;
          calLink = parsedUrl.pathname + parsedUrl.search;
          if (calLink.startsWith("/")) {
            calLink = calLink.substring(1);
          }
        } else {
          return res.status(400).json({ message: "URL must be for cal.com or a subdomain of cal.com" });
        }
      } catch {
        return res.status(400).json({ message: "Invalid URL format" });
      }
    } else {
      calLink = url.replace(`${WEBAPP_URL}/`, "");
      // Flowko: this branch took any input and reflected it into the page's script (AC-1, reflected XSS)
      if (!isSafeRelativeCalLink(calLink)) return res.status(400).json({ message: "Invalid URL format" });
    }

    // Generate HTML with embedded Cal component
    const htmlResponse = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Cal.diy</title>
          <meta charset="UTF-8" />
          <script src="https://s3.amazonaws.com/intercom-sheets.com/messenger-sheet-library.latest.js"></script>
        </head>

        <body>
          <!-- Cal inline embed code begins -->
          <div style="width: 100%; height: 100%; overflow: auto" id="my-cal-inline"></div>
          <script type="text/javascript">
            (function (C, A, L) {
              let p = function (a, ar) { a.q.push(ar); };
              let d = C.document;
              C.Cal =
                C.Cal ||
                function () {
                  let cal = C.Cal;
                  let ar = arguments;
                  if (!cal.loaded) {
                    cal.ns = {};
                    cal.q = cal.q || [];
                    d.head.appendChild(d.createElement("script")).src = A;
                    cal.loaded = true;
                  }
                  if (ar[0] === L) {
                    const api = function () { p(api, arguments); };
                    const namespace = ar[1];
                    api.q = api.q || [];
                    if (typeof namespace === "string") {
                      cal.ns[namespace] = cal.ns[namespace] || api;
                      p(cal.ns[namespace], ar);
                      p(cal, ["initNamespace", namespace]);
                    } else p(cal, ar);
                    return;
                  }
                  p(cal, ar);
                };
            })(window, "https://app.cal.com/embed/embed.js", "init");

            Cal("init", { origin: ${toInlineScriptString(origin)} });

            Cal("inline", {
              elementOrSelector: "#my-cal-inline",
              calLink: ${toInlineScriptString(calLink)},
              config: {
                theme: "light",
              },
            });
           
           Cal("on", {
              action: "bookingSuccessful",
              callback: (e) => {
                console.log("bookingSuccessful", e)
                try { 
                  INTERCOM_MESSENGER_SHEET_LIBRARY.submitSheet(e.detail.data)
                } catch(error) {
                  console.log("Error Intercom sheet", error)
                }
              }
            });

          </script>
          <!-- Cal inline embed code ends -->
        </body>
      </html>
    `;

    res.status(200).send(htmlResponse);
  } else {
    res.status(405).end(); // Method Not Allowed
  }
}
