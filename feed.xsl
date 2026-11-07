<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>

  <xsl:template match="/rss">
    <html lang="zh-Hant">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="channel/title"/></title>
        <style>
          :root { --paper:#f7f4ec; --ink:#1b2224; --ink2:#4a5457; --ink3:#7c8585; --rule:#d9d2c1; --accent:#8c2f1f; }
          @media (prefers-color-scheme: dark) {
            :root { --paper:#121719; --ink:#e7e3d9; --ink2:#b0aa9e; --ink3:#837f76; --rule:#2f3639; --accent:#d9694e; }
          }
          body {
            margin:0; padding:34px 20px 60px;
            background:var(--paper); color:var(--ink);
            font-family:"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,Georgia,serif;
            line-height:1.75;
          }
          .wrap { max-width:760px; margin:0 auto; }
          header { text-align:center; border-bottom:2px solid var(--rule); padding-bottom:16px; margin-bottom:26px; }
          h1 { margin:0 0 6px; font-size:1.6rem; letter-spacing:.2em; }
          .meta { font-family:system-ui,sans-serif; font-size:.74rem; color:var(--ink3); letter-spacing:.06em; }
          .meta span + span::before { content:" · "; }
          ol { list-style:none; margin:0; padding:0; counter-reset:item; }
          li { counter-increment:item; position:relative; padding:16px 0 16px 44px; border-bottom:1px dashed var(--rule); }
          li::before {
            content:counter(item,decimal-leading-zero);
            position:absolute; left:0; top:17px;
            font-size:1.1rem; color:var(--rule);
          }
          h2 { margin:0 0 6px; font-size:1rem; line-height:1.6; }
          h2 a { color:var(--ink); text-decoration:none; }
          h2 a:hover { color:var(--accent); text-decoration:underline; text-underline-offset:3px; }
          p { margin:0 0 4px; font-size:.86rem; color:var(--ink2); }
          .date { font-family:system-ui,sans-serif; font-size:.68rem; color:var(--ink3); }
          footer { margin-top:30px; padding-top:14px; border-top:1px solid var(--rule); font-family:system-ui,sans-serif; font-size:.72rem; color:var(--ink3); text-align:center; }
          a { color:var(--accent); }
        </style>
      </head>
      <body>
        <div class="wrap">
          <header>
            <h1><xsl:value-of select="channel/title"/></h1>
            <div class="meta">
              <span><xsl:value-of select="channel/description"/></span>
              <span>更新：<xsl:value-of select="channel/lastBuildDate"/></span>
            </div>
          </header>

          <ol>
            <xsl:for-each select="channel/item">
              <li>
                <h2><a href="{link}"><xsl:value-of select="title"/></a></h2>
                <xsl:if test="description">
                  <p><xsl:value-of select="description"/></p>
                </xsl:if>
                <div class="date"><xsl:value-of select="pubDate"/></div>
              </li>
            </xsl:for-each>
          </ol>

          <footer>
            這是給 RSS 閱讀器訂閱的來源；用閱讀器訂閱即可每日收到要目。
          </footer>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
