require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const path = require('path');

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));

// Ruta raíz que sirve el index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});



app.use(express.json());

app.get('/analyze', async (req, res) => {
  const url = req.query.url;
  
  if (!url) {
    return res.status(400).json({ error: 'URL requerida' });
  }

  try {
    // 1. Consultar Google PageSpeed con ambas categorías
    const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${process.env.GOOGLE_API_KEY}&category=performance&category=seo&strategy=mobile`;
    
    const psiResponse = await axios.get(psiUrl);
    
    if (!psiResponse.data || !psiResponse.data.lighthouseResult) {
      throw new Error('Respuesta inválida de PageSpeed API');
    }

    const psiData = psiResponse.data.lighthouseResult;
    
    // 2. Hacer scraping del HTML
    const htmlResponse = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(htmlResponse.data);
    
    // 3. Extraer datos SEO + AIO
    const seoData = {
      title: $('title').text().trim() || null,
      metaDescription: $('meta[name="description"]').attr('content') || null,
      h1Count: $('h1').length,
      h2Count: $('h2').length,
      hasSchema: $('script[type="application/ld+json"]').length > 0,
      hasOpenGraph: $('meta[property="og:title"]').length > 0,
      imagesWithoutAlt: $('img:not([alt]), img[alt=""]').length,
      hasBlog: $('a[href*="/blog"], a[href*="/noticias"], a[href*="/blog/"]').length > 0,
      hasFAQ: $('*').filter(function() {
        const text = $(this).text().toLowerCase();
        return text.includes('preguntas frecuentes') || text.includes('faq');
      }).length > 0
    };

    // 4. Calcular scores AIM
    const scores = calculateAIMScores(psiData, seoData);

    res.json({
      url,
      pagespeed: {
        performance: Math.round(psiData.categories.performance.score * 100),
        seo: Math.round(psiData.categories.seo.score * 100),
        fcp: psiData.audits['first-contentful-paint']?.displayValue || 'N/A',
        lcp: psiData.audits['largest-contentful-paint']?.displayValue || 'N/A',
        cls: psiData.audits['cumulative-layout-shift']?.displayValue || 'N/A'
      },
      seo: seoData,
      scores: scores
    });

  } catch (error) {
    console.error('Error detallado:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
    }
    res.status(500).json({ error: 'Error al analizar la URL: ' + error.message });
  }
});

function calculateAIMScores(psiData, seoData) {
  const techScore = psiData.categories.performance.score * 100;
  
  let seoScore = 0;
  if (seoData.title) seoScore += 20;
  if (seoData.metaDescription) seoScore += 20;
  if (seoData.h1Count === 1) seoScore += 20;
  if (seoData.imagesWithoutAlt === 0) seoScore += 20;
  if (seoData.hasOpenGraph) seoScore += 20;
  
  let aioScore = 0;
  if (seoData.hasSchema) aioScore += 30;
  if (seoData.hasBlog) aioScore += 25;
  if (seoData.hasFAQ) aioScore += 25;
  if (seoData.h2Count >= 3) aioScore += 20;
  
  const totalScore = (techScore * 0.4) + (seoScore * 0.3) + (aioScore * 0.3);
  
  return {
    technical: Math.round(techScore),
    seo: Math.round(seoScore),
    aio: Math.round(aioScore),
    total: Math.round(totalScore)
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AIM SEO Analyzer corriendo en http://localhost:${PORT}`);
});