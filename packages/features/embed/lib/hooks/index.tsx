import { useEmbedBookerUrl } from "@calcom/features/bookings/hooks/useBookerUrl";
import { useLocale } from "@calcom/lib/hooks/useLocale";

// Flowko U13-05 (Q10): three embed types. The email embed (available times pasted into an e-mail) is not
// offered; Embed.tsx closes the dialog for any type that isn't in this list.
export const useEmbedTypes = () => {
  const { t } = useLocale();
  return [
    {
      title: t("inline_embed"),
      subtitle: t("load_inline_content"),
      type: "inline",
      illustration: (
        <svg
          width="100%"
          height="100%"
          className="rounded-md"
          viewBox="0 0 308 265"
          fill="none"
          xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0 1.99999C0 0.895423 0.895431 0 2 0H306C307.105 0 308 0.895431 308 2V263C308 264.105 307.105 265 306 265H2C0.895431 265 0 264.105 0 263V1.99999Z"
            fill="white"
          />
          <rect x="24" width="260" height="38.5" rx="6" fill="#F3F4F6" />
          <rect x="24.5" y="51" width="139" height="163" rx="1.5" fill="#F8F8F8" />
          <rect opacity="0.8" x="48" y="74.5" width="80" height="8" rx="6" fill="#F3F4F6" />
          <rect x="48" y="86.5" width="48" height="4" rx="6" fill="#F3F4F6" />
          <rect x="49" y="99.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="61" y="99.5" width="6" height="6" rx="1" fill="#3E3E3E" />
          <rect x="73" y="99.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="85" y="99.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="97" y="99.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="109" y="99.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="121" y="99.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="133" y="99.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="85" y="113.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="97" y="113.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="109" y="113.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="121" y="113.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="133" y="113.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="49" y="125.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="61" y="125.5" width="6" height="6" rx="1" fill="#3E3E3E" />
          <path
            d="M61 124.5H67V122.5H61V124.5ZM68 125.5V131.5H70V125.5H68ZM67 132.5H61V134.5H67V132.5ZM60 131.5V125.5H58V131.5H60ZM61 132.5C60.4477 132.5 60 132.052 60 131.5H58C58 133.157 59.3431 134.5 61 134.5V132.5ZM68 131.5C68 132.052 67.5523 132.5 67 132.5V134.5C68.6569 134.5 70 133.157 70 131.5H68ZM67 124.5C67.5523 124.5 68 124.948 68 125.5H70C70 123.843 68.6569 122.5 67 122.5V124.5ZM61 122.5C59.3431 122.5 58 123.843 58 125.5H60C60 124.948 60.4477 124.5 61 124.5V122.5Z"
            fill="#3E3E3E"
          />
          <rect x="73" y="125.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="85" y="125.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="97" y="125.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="109" y="125.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="121" y="125.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="133" y="125.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="49" y="137.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="61" y="137.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="73" y="137.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="85" y="137.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="97" y="137.5" width="6" height="6" rx="1" fill="#3E3E3E" />
          <rect x="109" y="137.5" width="6" height="6" rx="1" fill="#3E3E3E" />
          <rect x="121" y="137.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="133" y="137.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="49" y="149.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="61" y="149.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="73" y="149.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="85" y="149.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="97" y="149.5" width="6" height="6" rx="1" fill="#3E3E3E" />
          <rect x="109" y="149.5" width="6" height="6" rx="1" fill="#3E3E3E" />
          <rect x="121" y="149.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="133" y="149.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="49" y="161.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="61" y="161.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="73" y="161.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="85" y="161.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="97" y="161.5" width="6" height="6" rx="1" fill="#3E3E3E" />
          <rect x="109" y="161.5" width="6" height="6" rx="1" fill="#C6C6C6" />
          <rect x="24.5" y="51" width="139" height="163" rx="6" stroke="#292929" />
          <rect x="176" y="50.5" width="108" height="164" rx="6" fill="#F3F4F6" />
          <rect x="24" y="226.5" width="260" height="38.5" rx="6" fill="#F3F4F6" />
        </svg>
      ),
    },
    {
      title: t("floating_pop_up_button"),
      subtitle: t("floating_button_trigger_modal"),
      type: "floating-popup",
      illustration: (
        <svg
          width="100%"
          height="100%"
          className="rounded-md"
          viewBox="0 0 308 265"
          fill="none"
          xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0 1.99999C0 0.895423 0.895431 0 2 0H306C307.105 0 308 0.895431 308 2V263C308 264.105 307.105 265 306 265H2C0.895431 265 0 264.105 0 263V1.99999Z"
            fill="white"
          />
          <rect x="24" width="260" height="38.5" rx="6" fill="#F3F4F6" />
          <rect x="24" y="50.5" width="120" height="76" rx="6" fill="#F3F4F6" />
          <rect x="24" y="138.5" width="120" height="76" rx="6" fill="#F3F4F6" />
          <rect x="156" y="50.5" width="128" height="164" rx="6" fill="#F3F4F6" />
          <rect x="24" y="226.5" width="260" height="38.5" rx="6" fill="#F3F4F6" />
          <rect x="226" y="223.5" width="66" height="26" rx="6" fill="#292929" />
          <rect x="242" y="235.5" width="34" height="2" rx="1" fill="white" />
        </svg>
      ),
    },
    {
      title: t("pop_up_element_click"),
      subtitle: t("open_dialog_with_element_click"),
      type: "element-click",
      illustration: (
        <svg
          width="100%"
          height="100%"
          className="rounded-md"
          viewBox="0 0 308 265"
          fill="none"
          xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0 1.99999C0 0.895423 0.895431 0 2 0H306C307.105 0 308 0.895431 308 2V263C308 264.105 307.105 265 306 265H2C0.895431 265 0 264.105 0 263V1.99999Z"
            fill="white"
          />
          <rect x="24" y="0.50293" width="260" height="24" rx="6" fill="#F3F4F6" />
          <rect x="24" y="35" width="259" height="192" rx="5.5" fill="#F9FAFB" />
          <g filter="url(#filter0_i_3223_14162)">
            <rect opacity="0.8" x="40" y="99" width="24" height="24" rx="2" fill="#E5E7EB" />
            <rect x="40" y="127" width="48" height="8" rx="1" fill="#E5E7EB" />
            <rect x="40" y="139" width="82" height="8" rx="1" fill="#E5E7EB" />
            <rect x="40" y="151" width="34" height="4" rx="1" fill="#E5E7EB" />
            <rect x="40" y="159" width="34" height="4" rx="1" fill="#E5E7EB" />
          </g>
          <rect x="152" y="48" width="2" height="169" rx="2" fill="#E5E7EB" />

          <rect opacity="0.8" x="176" y="84" width="80" height="8" rx="2" fill="#E5E7EB" />
          <rect x="176" y="96" width="48" height="4" rx="1" fill="#E5E7EB" />
          <rect x="177" y="109" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="189" y="109" width="6" height="6" rx="1" fill="#0D121D" />
          <rect x="201" y="109" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="213" y="109" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="225" y="109" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="237" y="109" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="249" y="109" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="261" y="109" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="213" y="123" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="225" y="123" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="237" y="123" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="249" y="123" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="261" y="123" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="177" y="135" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="189" y="135" width="6" height="6" rx="1" fill="#0D121D" />
          <rect x="187.3" y="133.4" width="9" height="9" rx="1.5" stroke="#0D121D" />
          <rect x="201" y="135" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="213" y="135" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="225" y="135" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="237" y="135" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="249" y="135" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="261" y="135" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="177" y="147" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="189" y="147" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="201" y="147" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="213" y="147" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="225" y="147" width="6" height="6" rx="1" fill="#0D121D" />
          <rect x="237" y="147" width="6" height="6" rx="1" fill="#0D121D" />
          <rect x="249" y="147" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="261" y="147" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="177" y="159" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="189" y="159" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="201" y="159" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="213" y="159" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="225" y="159" width="6" height="6" rx="1" fill="#0D121D" />
          <rect x="237" y="159" width="6" height="6" rx="1" fill="#0D121D" />
          <rect x="249" y="159" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="261" y="159" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="177" y="171" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="189" y="171" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="201" y="171" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="213" y="171" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="225" y="171" width="6" height="6" rx="1" fill="#0D121D" />
          <rect x="237" y="171" width="6" height="6" rx="1" fill="#E5E7EB" />
          <rect x="24" y="35" width="259" height="192" rx="5.5" stroke="#101010" />
          <rect x="24" y="241.503" width="260" height="24" rx="6" fill="#F3F4F6" />
        </svg>
      ),
    },
  ];
};

export const useEmbedCalOrigin = () => {
  const bookerUrl = useEmbedBookerUrl();
  return bookerUrl;
};
