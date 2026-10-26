import Document, { Html, Head, Main, NextScript } from 'next/document';

class MyDocument extends Document {
  render() {
    const themeInit = `(() => { try { const t = localStorage.getItem('theme'); const dark = (t ? t : 'dark') === 'dark'; const el = document.documentElement; if (dark) { el.classList.add('dark'); } else { el.classList.remove('dark'); } } catch (e) { try { document.documentElement.classList.add('dark'); } catch(_){} } })();`;
    return (
      <Html>
        <Head>
          {/* Installable web app: manifest, icon and browser chrome colour */}
          <link rel="manifest" href="/manifest.json" />
          <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
          <meta name="theme-color" content="#14532d" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="apple-mobile-web-app-title" content="Table" />
        </Head>
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
