export default function MyExternalScript({ html, state }) {
  return html`
<input type="range">
<script src="_static/range.mjs"></script>
<script src="_static/another.mjs"></script>
  `
}
