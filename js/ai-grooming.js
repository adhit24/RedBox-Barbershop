/**
 * AI Grooming Assistant - Frontend Integration
 * Connects to backend API for face analysis, hairstyle & outfit recommendations
 * 
 * Note: This is for LOCAL TESTING until May 16, 2026 deployment
 */

class AIGroomingService {
  constructor() {
    // API Base URL - change for production
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    this.API_BASE = isLocalhost
      ? 'http://localhost:3001/api/ai'
      : '/api/ai';
    
    // Check multiple token sources (main app uses redbox_user or supabase)
    this.token = this._getAuthToken();
    this.currentUpload = null;
  }

  // Get auth token from various sources
  _getAuthToken() {
    // Try different localStorage keys used by the main app
    const userData = localStorage.getItem('redbox_user');
    if (userData) {
      try {
        const user = JSON.parse(userData);
        // Accept any logged-in user (main app stores loggedIn: true)
        if (user && (user.loggedIn || user.id || user.email)) {
          return user.token || 'member-token-' + (user.id || user.email || 'user');
        }
      } catch (e) {
        console.log('Error parsing user data:', e);
      }
    }
    
    // Fallback to auth_token
    return localStorage.getItem('auth_token') || localStorage.getItem('sb-token');
  }

  // Set auth token after login
  setAuthToken(token) {
    this.token = token;
    localStorage.setItem('auth_token', token);
  }

  // Check if user is authenticated - supports both member and admin tokens
  isAuthenticated() {
    // Check if user data exists in localStorage
    const hasUserData = !!localStorage.getItem('redbox_user');
    const hasToken = !!this.token;
    const hasAdminToken = !!localStorage.getItem('rb_admin_token');
    
    return hasUserData || hasToken || hasAdminToken;
  }

  // Convert file to base64
  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Upload image for analysis
  async uploadImage(file, serviceType = 'full_analysis') {
    try {
      this.lastServiceType = serviceType;
      // Convert file to base64 for Vercel serverless functions
      const base64Image = await this._fileToBase64(file);
      
      const response = await fetch(`${this.API_BASE}/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          image: base64Image,
          serviceType: serviceType,
          fileName: file.name
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await response.json();
      this.currentUpload = data;
      return data;

    } catch (error) {
      console.error('Upload error:', error);
      // Check if server is not running (HTML response instead of JSON)
      if (error instanceof SyntaxError && error.message.includes('Unexpected token')) {
        throw new Error('Server belum jalan. Jalankan: node server/index.js');
      }
      throw error;
    }
  }

  // Start AI analysis
  async startAnalysis(uploadId, serviceType) {
    try {
      const response = await fetch(`${this.API_BASE}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ uploadId, serviceType })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Analysis failed');
      }

      const data = await response.json();
      if (data && !data.serviceType && serviceType) data.serviceType = serviceType;
      return data;

    } catch (error) {
      console.error('Analysis error:', error);
      throw error;
    }
  }

  // Check processing status
  async checkStatus(uploadId) {
    try {
      const response = await fetch(`${this.API_BASE}/status/${uploadId}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.status === 404) {
        return { uploadId, status: 'missing' };
      }
      if (!response.ok) throw new Error('Status check failed');
      return await response.json();

    } catch (error) {
      return null;
    }
  }

  // Get analysis results
  async getResults(uploadId) {
    try {
      const response = await fetch(`${this.API_BASE}/results/${uploadId}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Failed to get results');
      return await response.json();

    } catch (error) {
      console.error('Get results error:', error);
      throw error;
    }
  }

  // Poll status until complete
  async pollUntilComplete(uploadId, onProgress) {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        try {
          const status = await this.checkStatus(uploadId);
          
          if (!status) {
            clearInterval(checkInterval);
            reject(new Error('Status check failed'));
            return;
          }

          onProgress?.(status);

          if (status.status === 'missing') {
            const fallback = await this.startAnalysis(uploadId, this.lastServiceType);
            if (fallback && fallback.status === 'completed' && fallback.results) {
              clearInterval(checkInterval);
              resolve({
                uploadId,
                status: 'completed',
                serviceType: fallback.serviceType || this.lastServiceType,
                results: fallback.results,
                message: fallback.message,
              });
              return;
            }
          }

          if (status.status === 'completed') {
            clearInterval(checkInterval);
            const results = await this.getResults(uploadId);
            resolve(results);
          } else if (status.status === 'failed') {
            clearInterval(checkInterval);
            reject(new Error(status.errorMessage || 'Processing failed'));
          }

        } catch (error) {
          clearInterval(checkInterval);
          reject(error);
        }
      }, 2000); // Check every 2 seconds
    });
  }

  // Get user credits
  async getCredits() {
    try {
      const response = await fetch(`${this.API_BASE}/credits`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Failed to get credits');
      return await response.json();

    } catch (error) {
      console.error('Get credits error:', error);
      return { credits: 0 };
    }
  }

  // Get analysis history
  async getHistory(limit = 10) {
    try {
      const response = await fetch(`${this.API_BASE}/history?limit=${limit}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Failed to get history');
      return await response.json();

    } catch (error) {
      console.error('Get history error:', error);
      return { history: [] };
    }
  }
}

// UI Controller
class AIGroomingUI {
  constructor() {
    this.aiService = new AIGroomingService();
    this.currentStep = 'upload'; // upload, processing, results
    this.init();
  }

  init() {
    this.bindEvents();
    this.setupDragDrop();
    this.checkMembershipStatus();
  }

  // Check if user is logged in/member and toggle UI sections
  checkMembershipStatus() {
    const isMember = this.aiService.isAuthenticated();
    
    // Get UI sections
    const memberPromoSection = document.querySelector('.ai-member-promo');
    const uploadSection = document.getElementById('ai-upload-section');
    const lockedPreview = document.querySelector('.ai-locked-preview');
    
    if (isMember) {
      // User is logged in - hide promo, show upload
      if (memberPromoSection) {
        memberPromoSection.style.display = 'none';
      }
      if (uploadSection) {
        uploadSection.style.display = 'block';
      }
      if (lockedPreview) {
        lockedPreview.style.display = 'none';
      }
      console.log('[AI Grooming] Member detected - showing upload section');
    } else {
      // User not logged in - show promo, hide upload
      if (memberPromoSection) {
        memberPromoSection.style.display = 'block';
      }
      if (uploadSection) {
        uploadSection.style.display = 'none';
      }
      console.log('[AI Grooming] Non-member detected - showing promo section');
    }
  }

  bindEvents() {
    // Upload buttons
    const uploadInput = document.getElementById('ai-upload-input');
    const uploadBtn = document.getElementById('ai-upload-btn');
    const analyzeBtn = document.getElementById('ai-analyze-btn');

    if (uploadInput) {
      uploadInput.addEventListener('change', (e) => this.handleFileSelect(e));
    }

    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => uploadInput?.click());
    }

    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => this.startAnalysis());
    }

    // Feature cards - scroll to upload on click
    document.querySelectorAll('.ai-feature-card').forEach(card => {
      card.addEventListener('click', () => {
        this.scrollToUpload();
      });
    });
  }

  setupDragDrop() {
    const uploadZone = document.getElementById('ai-upload-zone');
    if (!uploadZone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      uploadZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    uploadZone.addEventListener('dragenter', () => {
      uploadZone.classList.add('drag-over');
    });

    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('drag-over');
    });

    uploadZone.addEventListener('drop', (e) => {
      uploadZone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length) this.handleFile(files[0]);
    });
  }

  handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) this.handleFile(file);
  }

  handleFile(file) {
    // Validate file
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      this.showError('Please upload a valid image (JPG, PNG, WebP)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      this.showError('File too large. Max 10MB.');
      return;
    }

    // Show preview
    this.showImagePreview(file);
    this.selectedFile = file;
    
    // Update analyze button based on auth status
    const analyzeBtn = document.getElementById('ai-analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      if (this.aiService.isAuthenticated()) {
        analyzeBtn.textContent = 'Generate';
        this.hideError(); // Clear any login error
      } else {
        analyzeBtn.textContent = 'Login to Continue';
      }
    }
  }

  showImagePreview(file) {
    const preview = document.getElementById('ai-image-preview');
    const placeholder = document.getElementById('ai-upload-placeholder');
    
    if (!preview) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  scrollToUpload() {
    const uploadSection = document.getElementById('ai-upload-section');
    if (uploadSection) {
      uploadSection.scrollIntoView({ behavior: 'smooth' });
    }
  }

  async startAnalysis() {
    if (!this.selectedFile) {
      this.showError('Please select an image first');
      return;
    }

    if (!this.aiService.isAuthenticated()) {
      this.showLoginModal();
      return;
    }

    const serviceType = 'full_analysis';
    
    try {
      this.showLoading('Uploading image...');
      
      // Upload
      const upload = await this.aiService.uploadImage(this.selectedFile, serviceType);
      
      this.showLoading('Starting AI analysis...');
      
      // Start analysis
      const analysis = await this.aiService.startAnalysis(upload.uploadId, serviceType);
      if (analysis && analysis.status === 'completed' && analysis.results) {
        this.displayResults({
          uploadId: upload.uploadId,
          status: 'completed',
          serviceType,
          results: analysis.results,
          message: analysis.message,
        });
        return;
      }
      
      this.showLoading('AI is analyzing your photo...');
      
      // Poll for results
      const results = await this.aiService.pollUntilComplete(
        upload.uploadId,
        (status) => {
          if (status.status === 'processing') {
            this.showLoading(`Processing... ${status.progress || ''}`);
          }
        }
      );
      
      // Show results
      this.displayResults(results);
      
    } catch (error) {
      this.hideLoading();
      console.error('Analysis error:', error);
      
      // Special handling for local testing period (until May 16, 2026)
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        this.showError('⚠️ Server belum siap. Pastikan backend running (node server/index.js)');
      } else if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
        this.showError('Silakan login terlebih dahulu untuk menggunakan fitur AI');
      } else {
        this.showError(error.message || 'Analysis failed. Please try again.');
      }
    }
  }

  displayResults(results) {
    this.currentStep = 'results';
    
    this.hideLoading();

    const resultsContainer = document.getElementById('ai-results');
    if (!resultsContainer) return;

    resultsContainer.style.display = 'block';
    
    // Hide upload section
    const uploadSection = document.getElementById('ai-upload-section');
    if (uploadSection) uploadSection.style.display = 'none';

    // Render based on service type
    switch (results.serviceType) {
      case 'full_analysis':
        this.renderFullAnalysis(results.results);
        break;
      case 'face_analysis':
        this.renderFaceAnalysis(results.results);
        break;
      case 'hairstyle':
        this.renderHairstyleResults(results.results);
        break;
      case 'outfit':
        this.renderOutfitResults(results.results);
        break;
      case 'preview':
        this.renderPreviewResults(results.results);
        break;
    }

    // Scroll to results
    resultsContainer.scrollIntoView({ behavior: 'smooth' });
  }

  renderFullAnalysis(results) {
    const container = document.getElementById('ai-results-content');
    if (!container) return;

    const r = results || {};
    const color = r.personalColor || {};
    const outfit = r.outfit || {};
    const eyewear = r.eyewear || {};
    const skincare = r.skincare || {};
    const hair = r.hairstyle || {};

    const sectionTitle = (icon, title) =>
      `<div class="ai-section-header"><span class="ai-section-icon">${icon}</span><h3>${title}</h3></div>`;

    const colorSwatches = (items, label) => {
      if (!items || !items.length) return '';
      return `<div class="ai-color-row">${items.map(c => `
        <div class="ai-swatch-item">
          <div class="ai-swatch" style="background:${c.hex}"></div>
          <span class="ai-swatch-name">${c.name}</span>
          <span class="ai-swatch-label">${c.label}</span>
        </div>`).join('')}</div>`;
    };

    const html = `
      <div class="ai-full-results">

        <!-- 1. PERSONAL COLOR -->
        <div class="ai-result-card">
          ${sectionTitle('🎨', 'Personal Color Analysis')}
          <div class="ai-color-season">
            <span class="ai-season-badge">${color.colorSeason || '—'}</span>
            <p>${color.colorSeasonDescription || ''}</p>
          </div>
          <div class="ai-color-block">
            <h4>Best Colors</h4>
            ${colorSwatches(color.bestColors, 'best')}
          </div>
          <div class="ai-color-block">
            <h4>Colors to Avoid</h4>
            ${colorSwatches(color.avoidColors, 'avoid')}
          </div>
          ${color.outfitFormula ? `<p class="ai-formula"><strong>Formula:</strong> ${color.outfitFormula}</p>` : ''}
        </div>

        <!-- 2. OUTFIT BY FACE SHAPE -->
        <div class="ai-result-card">
          ${sectionTitle('👔', 'Outfit Recommendations')}
          <p class="ai-face-tag">Face Shape: <strong>${outfit.faceShape || '—'}</strong> — ${outfit.faceShapeDescription || ''}</p>
          <div class="ai-outfit-grid">
            ${(outfit.recommendedOutfits || []).map(o => `
              <div class="ai-outfit-card">
                <div class="ai-outfit-rank">#${o.rank}</div>
                <h4>${o.name} <span class="ai-tag">${o.occasion}</span></h4>
                <ul class="ai-outfit-items">
                  ${(o.items || []).map(i => `
                    <li><span class="ai-piece-dot" style="background:${i.color}"></span><strong>${i.piece}:</strong> ${i.description}</li>
                  `).join('')}
                </ul>
                <p class="ai-why">${o.whyItWorks}</p>
                <span class="ai-style-keyword">${o.styleKeyword}</span>
              </div>
            `).join('')}
          </div>
          ${(outfit.avoidOutfits || []).length ? `
            <div class="ai-avoid-section">
              <h4>Avoid</h4>
              <ul>${(outfit.avoidOutfits || []).map(a => `<li><strong>${a.style}:</strong> ${a.reason}</li>`).join('')}</ul>
            </div>` : ''}
        </div>

        <!-- 3. EYEWEAR -->
        <div class="ai-result-card">
          ${sectionTitle('🕶️', 'Eyewear Recommendations')}
          <div class="ai-eyewear-grid">
            ${(eyewear.recommendations || []).map(e => `
              <div class="ai-eyewear-card">
                <span class="ai-eyewear-cat">${e.category}</span>
                <h4>${e.name}</h4>
                <p><strong>Frame:</strong> ${e.frameShape} · ${e.material}</p>
                <p><strong>Colors:</strong> ${(e.recommendedColors || []).join(', ')}</p>
                <p class="ai-why">${e.whyItSuits}</p>
                <p><em>${e.bestFor}</em></p>
                <div class="ai-score-bar">
                  <div class="ai-score-fill" style="width:${e.suitabilityScore || 80}%"></div>
                  <span>${e.suitabilityScore || 80}% match</span>
                </div>
              </div>
            `).join('')}
          </div>
          ${(eyewear.avoidFrames || []).length ? `
            <div class="ai-avoid-section">
              <h4>Avoid</h4>
              <ul>${(eyewear.avoidFrames || []).map(a => `<li><strong>${a.style}:</strong> ${a.reason}</li>`).join('')}</ul>
            </div>` : ''}
          ${eyewear.proTip ? `<p class="ai-pro-tip">💡 ${eyewear.proTip}</p>` : ''}
        </div>

        <!-- 4. SKINCARE -->
        <div class="ai-result-card">
          ${sectionTitle('✨', 'Skincare Analysis & Routine')}
          <div class="ai-skin-profile">
            <span class="ai-tag">${skincare.skinProfile?.type || '—'}</span>
            <span class="ai-tag">${skincare.skinProfile?.tone || '—'} skin</span>
            <span class="ai-tag">${skincare.skinProfile?.hydrationLevel || '—'}</span>
          </div>
          <div class="ai-concerns">
            ${(skincare.concerns || []).map(c => `
              <div class="ai-concern-item">
                <strong>${c.issue}</strong>
                <span class="ai-severity ai-severity-${c.severity}">${c.severity}</span>
                <p>${c.tip}</p>
              </div>
            `).join('')}
          </div>
          <div class="ai-routines">
            <div class="ai-routine-block">
              <h4>☀️ Morning Routine</h4>
              <ol>${(skincare.morningRoutine || []).map(s => `<li><strong>${s.product}</strong> — ${s.purpose} <em>(${s.duration})</em></li>`).join('')}</ol>
            </div>
            <div class="ai-routine-block">
              <h4>🌙 Evening Routine</h4>
              <ol>${(skincare.eveningRoutine || []).map(s => `<li><strong>${s.product}</strong> — ${s.purpose} <em>(${s.duration})</em></li>`).join('')}</ol>
            </div>
          </div>
          ${(skincare.lifestyleTips || []).length ? `
            <div class="ai-lifestyle-tips">
              <h4>Lifestyle Tips</h4>
              <ul>${(skincare.lifestyleTips || []).map(t => `<li>${t}</li>`).join('')}</ul>
            </div>` : ''}
          ${skincare.expectedResults ? `<p class="ai-expected">📅 ${skincare.expectedResults}</p>` : ''}
        </div>

        <!-- 5. HAIRSTYLE -->
        <div class="ai-result-card">
          ${sectionTitle('💈', 'Hairstyle Recommendations')}
          <div class="ai-hairstyle-grid">
            ${(hair.recommendations || []).map(h => `
              <div class="ai-hairstyle-card">
                <div class="ai-hairstyle-rank">#${h.rank}</div>
                <span class="ai-tag">${h.category}</span>
                <h4>${h.name}</h4>
                <p>${h.description}</p>
                <p class="ai-why">${h.whyItSuits}</p>
                <p><strong>Products:</strong> ${(h.stylingProducts || []).join(', ')}</p>
                <p><strong>Maintenance:</strong> ${h.maintenanceLevel} · ${h.maintenanceFrequency}</p>
                <div class="ai-score-bar">
                  <div class="ai-score-fill" style="width:${h.suitabilityScore || 80}%"></div>
                  <span>${h.suitabilityScore || 80}% match</span>
                </div>
              </div>
            `).join('')}
          </div>
          ${(hair.avoidHairstyles || []).length ? `
            <div class="ai-avoid-section">
              <h4>Hairstyles to Avoid</h4>
              <ul>${(hair.avoidHairstyles || []).map(a => `<li><strong>${a.style}</strong> (${a.category}): ${a.reason}</li>`).join('')}</ul>
            </div>` : ''}
          ${hair.barberTip ? `<p class="ai-pro-tip">💈 Barber Tip: ${hair.barberTip}</p>` : ''}
        </div>

      </div>
    `;

    container.innerHTML = html;
  }

  renderFaceAnalysis(analysis) {
    const container = document.getElementById('ai-results-content');
    if (!container) return;

    const html = `
      <div class="ai-result-card">
        <h3>Face Analysis Results</h3>
        
        <div class="ai-result-section">
          <h4>Face Shape</h4>
          <p class="ai-result-highlight">${analysis.faceShape || 'Oval'}</p>
          <p>${analysis.faceShapeDescription || 'Your face shape is versatile and suits many styles.'}</p>
        </div>

        <div class="ai-result-section">
          <h4>Skin Analysis</h4>
          <p><strong>Tone:</strong> ${analysis.skinTone || 'Medium'}</p>
          <p><strong>Undertone:</strong> ${analysis.skinUndertone || 'Warm'}</p>
          <p><strong>Recommendations:</strong> ${analysis.skinRecommendations?.join(', ') || 'Stay hydrated'}</p>
        </div>

        <div class="ai-result-section">
          <h4>Recommended Haircuts</h4>
          <ul class="ai-recommendation-list">
            ${(analysis.recommendations?.haircuts || []).map(h => `
              <li>
                <strong>${h.name}</strong>
                <p>${h.description}</p>
                <span class="ai-confidence">${h.confidence || 85}% match</span>
              </li>
            `).join('')}
          </ul>
        </div>

        <div class="ai-result-meta">
          <small>Processed in ${analysis.processingTime || '2.5'}s using ${analysis.model || 'gpt-4.1-mini'}</small>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  renderHairstyleResults(results) {
    const container = document.getElementById('ai-results-content');
    if (!container) return;

    const html = `
      <div class="ai-result-card">
        <h3>Hairstyle Recommendations</h3>
        
        <div class="ai-hairstyle-grid">
          ${(results.recommendations || []).map((rec, i) => `
            <div class="ai-hairstyle-card">
              <div class="ai-hairstyle-rank">#${i + 1}</div>
              <h4>${rec.name}</h4>
              <p>${rec.description}</p>
              <div class="ai-hairstyle-meta">
                <span class="ai-tag">${rec.category}</span>
                <span class="ai-maintenance">${rec.maintenance?.level || 'Medium'} maintenance</span>
              </div>
              <div class="ai-confidence-bar">
                <div class="ai-confidence-fill" style="width: ${rec.confidence || 80}%"></div>
                <span>${rec.confidence || 80}% match</span>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="ai-result-section">
          <h4>General Advice</h4>
          <p>${results.generalAdvice || 'Consult with your barber for best results.'}</p>
        </div>

        ${results.avoidStyles ? `
          <div class="ai-result-section">
            <h4>Styles to Avoid</h4>
            <ul>
              ${results.avoidStyles.map(s => `<li>${s}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;

    container.innerHTML = html;
  }

  renderOutfitResults(results) {
    const container = document.getElementById('ai-results-content');
    if (!container) return;

    const html = `
      <div class="ai-result-card">
        <h3>Style & Outfit Recommendations</h3>
        
        <div class="ai-result-section">
          <h4>Color Analysis</h4>
          <div class="ai-color-palette">
            ${(results.colorAnalysis?.recommendedColors || []).map(c => `
              <div class="ai-color-swatch" style="background: ${c.hex}" title="${c.name}">
                <span>${c.name}</span>
              </div>
            `).join('')}
          </div>
          <p><strong>Skin Tone:</strong> ${results.colorAnalysis?.skinTone || 'Medium'}</p>
          <p><strong>Best Colors:</strong> ${results.colorAnalysis?.bestColors?.join(', ') || 'Navy, White, Olive'}</p>
        </div>

        <div class="ai-result-section">
          <h4>Outfit Recommendations</h4>
          <div class="ai-outfit-list">
            ${(results.outfitRecommendations || []).map(outfit => `
              <div class="ai-outfit-card">
                <h5>${outfit.occasion}</h5>
                <p>${outfit.description}</p>
                <div class="ai-outfit-items">
                  ${outfit.items?.map(item => `<span class="ai-tag">${item}</span>`).join('') || ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        ${results.shoppingList ? `
          <div class="ai-result-section">
            <h4>Shopping List</h4>
            <ul class="ai-shopping-list">
              ${results.shoppingList.map(item => `<li>${item}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;

    container.innerHTML = html;
  }

  renderPreviewResults(results) {
    const container = document.getElementById('ai-results-content');
    if (!container) return;

    const html = `
      <div class="ai-result-card">
        <h3>AI Hairstyle Preview</h3>
        
        <div class="ai-preview-comparison">
          <div class="ai-preview-original">
            <h4>Original</h4>
            <img src="${results.originalImageUrl}" alt="Original">
          </div>
          <div class="ai-preview-arrow">→</div>
          <div class="ai-preview-generated">
            <h4>AI Generated</h4>
            ${results.generatedImageBase64 ? `
              <img src="data:image/png;base64,${results.generatedImageBase64}" alt="AI Preview">
            ` : '<p>Image generation in progress...</p>'}
          </div>
        </div>

        <div class="ai-result-actions">
          <button class="btn btn-primary" onclick="aiGrooming.downloadPreview()">
            Download Preview
          </button>
          <button class="btn btn-secondary" onclick="aiGrooming.bookAppointment()">
            Book Appointment
          </button>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  showLoading(message) {
    const loadingEl = document.getElementById('ai-loading');
    if (loadingEl) {
      loadingEl.style.display = 'flex';
      const textEl = loadingEl.querySelector('.ai-loading-text');
      if (textEl) textEl.textContent = message;
    }

    const loadingInner = document.querySelector('#ai-loading .ai-loading-inner');
    const preview = document.getElementById('ai-image-preview');
    if (loadingInner && preview && preview.src) {
      if (!this._aiPreviewOriginalParent) this._aiPreviewOriginalParent = preview.parentElement;
      preview.style.display = 'block';
      if (preview.parentElement !== loadingInner) {
        loadingInner.insertBefore(preview, loadingInner.firstChild);
      }
    }

    // Hide other sections
    const uploadSection = document.getElementById('ai-upload-section');
    const resultsSection = document.getElementById('ai-results');
    if (uploadSection) uploadSection.style.display = 'none';
    if (resultsSection) resultsSection.style.display = 'none';
  }

  hideLoading() {
    const loadingEl = document.getElementById('ai-loading');
    if (loadingEl) loadingEl.style.display = 'none';

    const preview = document.getElementById('ai-image-preview');
    const originalParent = this._aiPreviewOriginalParent;
    if (preview && originalParent && preview.parentElement !== originalParent) {
      originalParent.appendChild(preview);
    }
  }

  showError(message) {
    const errorEl = document.getElementById('ai-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
    console.error('[AI Grooming]', message);
  }

  hideError() {
    const errorEl = document.getElementById('ai-error');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
  }

  showLoginModal() {
    // Trigger existing login modal from main site
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.click();
    
    // Or show custom message
    this.showError('Please login to use AI features');
  }

  reset() {
    this.currentStep = 'upload';
    this.selectedFile = null;
    this.currentUpload = null;

    // Reset UI
    const preview = document.getElementById('ai-image-preview');
    const placeholder = document.getElementById('ai-upload-placeholder');
    const uploadSection = document.getElementById('ai-upload-section');
    const resultsSection = document.getElementById('ai-results');
    const analyzeBtn = document.getElementById('ai-analyze-btn');

    if (preview) {
      preview.src = '';
      preview.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'block';
    if (uploadSection) uploadSection.style.display = 'block';
    if (resultsSection) resultsSection.style.display = 'none';
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = 'Generate';
    }

    this.hideLoading();
  }

  downloadPreview() {
    const img = document.querySelector('#ai-results-content img');
    if (img) {
      const link = document.createElement('a');
      link.href = img.src;
      link.download = 'redbox-ai-preview.png';
      link.click();
    }
  }

  bookAppointment() {
    // Navigate to booking section
    const bookingSection = document.getElementById('booking');
    if (bookingSection) {
      bookingSection.scrollIntoView({ behavior: 'smooth' });
    }
  }
}

// Initialize on page load
let aiGrooming;
document.addEventListener('DOMContentLoaded', () => {
  aiGrooming = new AIGroomingUI();
  
  // Expose for debugging
  window.aiGrooming = aiGrooming;
  
  console.log('🤖 AI Grooming Assistant initialized');
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AIGroomingService, AIGroomingUI };
}
