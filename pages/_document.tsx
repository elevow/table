import Document, { Html, Head, Main, NextScript } from 'next/document';

class MyDocument extends Document {
  render() {
    const themeInit = `(() => { try { const t = localStorage.getItem('theme'); const dark = (t ? t : 'dark') === 'dark'; const el = document.documentElement; if (dark) { el.classList.add('dark'); } else { el.classList.remove('dark'); } } catch (e) { try { document.documentElement.classList.add('dark'); } catch(_){} } })();`;
    return (
      <Html>
        <Head />
        <body>
          {/* Ensure theme is applied before React hydration to avoid flash */}
          <script dangerouslySetInnerHTML={{ __html: themeInit }} />
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
