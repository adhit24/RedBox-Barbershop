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

  _getMemberState() {
    try {
      const userData = JSON.parse(localStorage.getItem('redbox_user') || 'null');
      if (!userData || !userData.loggedIn) return 'guest';
      const memberData = JSON.parse(localStorage.getItem('redbox_member') || 'null');
      if (memberData && memberData.membership_status === 'ACTIVE') return 'active_member';
      return 'logged_in';
    } catch (e) {
      return 'guest';
    }
  }

  _getGateHTML(state) {
    if (state === 'guest') {
      return `
        <div class="ai-locked-preview">
          <div class="ai-locked-overlay">
            <div class="ai-locked-icon">🔒</div>
            <h3 class="ai-locked-title">Fitur Khusus Member</h3>
            <p class="ai-locked-text">Login atau daftar sebagai member RedBox untuk menggunakan AI Grooming Consultant secara gratis.</p>
            <button class="ai-locked-btn" id="ai-gate-login-btn">Login / Daftar Member</button>
          </div>
        </div>`;
    }
    return `
      <div class="ai-locked-preview">
        <div class="ai-locked-overlay">
          <div class="ai-locked-icon">👑</div>
          <h3 class="ai-locked-title">Aktifkan Membership</h3>
          <p class="ai-locked-text">Fitur AI Grooming tersedia untuk member aktif RedBox. Aktifkan membership kamu di dashboard member.</p>
          <a href="member-dashboard.html" class="ai-locked-btn">Ke Dashboard Member</a>
        </div>
      </div>`;
  }

  _bindGateEvents(container) {
    const loginBtn = container.querySelector('#ai-gate-login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        const memberBtn = document.getElementById('memberBtn');
        if (memberBtn) memberBtn.click();
      });
    }
  }

  checkMembershipStatus() {
    const state = this._getMemberState();
    const promoSection = document.getElementById('ai-member-promo');
    const uploadSection = document.getElementById('ai-upload-section');

    if (state === 'active_member') {
      if (promoSection) promoSection.style.display = 'none';
      if (uploadSection) uploadSection.style.display = 'block';
    } else {
      if (uploadSection) uploadSection.style.display = 'none';
      if (promoSection) {
        promoSection.innerHTML = this._getGateHTML(state);
        promoSection.style.display = 'block';
        this._bindGateEvents(promoSection);
      }
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
      this.userPhotoUrl = e.target.result; // store for results display
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
    this.hideLoading();

    // Store results in sessionStorage then redirect to results page
    try {
      sessionStorage.setItem('ai_results', JSON.stringify(results));
      if (results.uploadId) sessionStorage.setItem('ai_upload_id', results.uploadId);
      if (this.userPhotoUrl) sessionStorage.setItem('ai_user_photo', this.userPhotoUrl);
    } catch (e) {
      console.error('sessionStorage error:', e);
    }

    window.location.href = '/ai-results.html';
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

    const block = (num, icon, title, body) => `
      <div class="ai-section-block">
        <div class="ai-section-header">
          <span class="ai-section-num">${num}</span>
          <h3>${icon} ${title}</h3>
        </div>
        <div class="ai-section-body">${body}</div>
      </div>`;

    const swatches = (items) => (items || []).map(c => `
      <div class="ai-swatch" style="background:${c.hex}" title="${c.name} — ${c.label}">
        <span class="ai-swatch-tip">${c.name}</span>
      </div>`).join('');

    // 1. Personal Color
    const colorHTML = `
      <div class="ai-color-season">🎨 ${color.colorSeason || '—'}</div>
      <p style="font-size:0.85rem;color:var(--text-sec);margin:4px 0 16px">${color.colorSeasonDescription || ''}</p>
      <div class="ai-color-grid">
        <div class="ai-color-group">
          <label>Best Colors</label>
          <div class="ai-swatches">${swatches(color.bestColors)}</div>
        </div>
        <div class="ai-color-group">
          <label>Avoid Colors</label>
          <div class="ai-swatches">${swatches(color.avoidColors)}</div>
        </div>
      </div>
      ${color.outfitFormula ? `<div class="ai-color-formula">✦ Formula: ${color.outfitFormula}</div>` : ''}`;

    // 2. Outfit — visual photo grid
    const outfitHTML = `
      <p class="ai-section-sub">Face Shape: <strong>${outfit.faceShape || '—'}</strong> — ${outfit.faceShapeDescription || ''}</p>
      <div class="ai-photo-grid ai-photo-grid-3">
        ${(outfit.recommendedOutfits || []).map(o => `
          <div class="ai-photo-card">
            <div class="ai-photo-card-img-wrap">
              ${o.imageUrl ? `<img src="${o.imageUrl}" alt="${o.name}" class="ai-photo-card-img" loading="lazy" />` : '<div class="ai-photo-card-placeholder">👔</div>'}
              <span class="ai-photo-card-rank">#${o.rank}</span>
            </div>
            <div class="ai-photo-card-body">
              <div class="ai-photo-card-name">${o.name}</div>
              <div class="ai-photo-card-occasion">${o.occasion}</div>
              <div class="ai-photo-card-pieces">
                ${(o.items || []).map(i => `<span class="ai-outfit-piece"><span class="ai-outfit-piece-dot" style="background:${i.color}"></span>${i.piece}</span>`).join('')}
              </div>
              <div class="ai-photo-card-why">${o.whyItWorks}</div>
            </div>
          </div>`).join('')}
      </div>
      ${(outfit.avoidOutfits || []).length ? `
        <div class="ai-outfit-avoid">
          <label>Avoid</label>
          <div class="ai-avoid-list">
            ${(outfit.avoidOutfits || []).map(a => `
              <div class="ai-avoid-item"><span class="ai-avoid-x">✕</span><span><strong>${a.style}</strong> — ${a.reason}</span></div>`).join('')}
          </div>
        </div>` : ''}`;

    // 3. Eyewear — visual photo grid
    const eyewearHTML = `
      <div class="ai-section-sub-label">RECOMMENDED</div>
      <div class="ai-photo-grid ai-photo-grid-3">
        ${(eyewear.recommendations || []).map(e => `
          <div class="ai-photo-card">
            <div class="ai-photo-card-img-wrap ai-photo-card-img-wide">
              ${e.imageUrl ? `<img src="${e.imageUrl}" alt="${e.name}" class="ai-photo-card-img" loading="lazy" />` : '<div class="ai-photo-card-placeholder">🕶️</div>'}
              <span class="ai-photo-card-score">${e.suitabilityScore || 80}%</span>
            </div>
            <div class="ai-photo-card-body">
              <div class="ai-photo-card-category">${e.category}</div>
              <div class="ai-photo-card-name">${e.name}</div>
              <div class="ai-eyewear-colors">
                ${(e.recommendedColors || []).map(c => `<span class="ai-eyewear-color-tag">${c}</span>`).join('')}
              </div>
              <div class="ai-photo-card-why">${e.whyItSuits}</div>
            </div>
          </div>`).join('')}
      </div>
      ${(eyewear.avoidFrames || []).length ? `
        <div class="ai-section-sub-label" style="color:var(--red);margin-top:20px">AVOID</div>
        <div class="ai-photo-grid ai-photo-grid-3">
          ${(eyewear.avoidFrames || []).map(a => `
            <div class="ai-photo-card ai-photo-card-avoid">
              <div class="ai-photo-card-img-wrap ai-photo-card-img-wide">
                ${a.imageUrl ? `<img src="${a.imageUrl}" alt="${a.style}" class="ai-photo-card-img" loading="lazy" />` : '<div class="ai-photo-card-placeholder">🚫</div>'}
                <span class="ai-photo-avoid-x">✕</span>
              </div>
              <div class="ai-photo-card-body">
                <div class="ai-photo-card-name">${a.style}</div>
                <div class="ai-photo-card-why">${a.reason}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}
      ${eyewear.proTip ? `<div class="ai-eyewear-protip">💡 ${eyewear.proTip}</div>` : ''}`;

    // 4. Skincare
    const skincareHTML = `
      <div class="ai-skincare-grid">
        <div class="ai-skincare-col">
          <label>☀️ Morning Routine</label>
          <div class="ai-routine-steps">
            ${(skincare.morningRoutine || []).map(s => `
              <div class="ai-routine-step">
                <span class="ai-step-num">${s.step}</span>
                <div class="ai-step-info">
                  <strong>${s.product}</strong>
                  <span>${s.purpose}</span>
                </div>
              </div>`).join('')}
          </div>
        </div>
        <div class="ai-skincare-col">
          <label>Skin Concerns</label>
          <div class="ai-concerns-list">
            ${(skincare.concerns || []).map(c => `
              <div class="ai-concern-item">
                <div class="ai-concern-name">${c.issue}</div>
                <span class="ai-concern-severity ${c.severity}">${c.severity}</span>
                <div class="ai-concern-tip">${c.tip}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>
      ${(skincare.lifestyleTips || []).length ? `
        <div class="ai-skincare-tips">
          <label>Lifestyle Tips</label>
          <ul class="ai-tips-list">
            ${skincare.lifestyleTips.map(t => `<li>${t}</li>`).join('')}
          </ul>
        </div>` : ''}`;

    // 5. Hairstyle — visual photo grid
    const hairHTML = `
      <div class="ai-section-sub-label">RECOMMENDED HAIRCUTS</div>
      <div class="ai-photo-grid ai-photo-grid-4">
        ${(hair.recommendations || []).map(h => `
          <div class="ai-photo-card">
            <div class="ai-photo-card-img-wrap">
              ${h.imageUrl ? `<img src="${h.imageUrl}" alt="${h.name}" class="ai-photo-card-img" loading="lazy" />` : '<div class="ai-photo-card-placeholder">💈</div>'}
              <span class="ai-photo-card-rank">#${h.rank}</span>
              <span class="ai-photo-card-score">${h.suitabilityScore || 80}%</span>
            </div>
            <div class="ai-photo-card-body">
              <div class="ai-photo-card-category">${h.category}</div>
              <div class="ai-photo-card-name">${h.name}</div>
              <div class="ai-hair-score-bar">
                <div class="ai-hair-score-fill" style="width:${h.suitabilityScore || 80}%"></div>
              </div>
              <div class="ai-hair-maintenance">
                <span class="ai-hair-tag">${h.maintenanceLevel}</span>
                <span class="ai-hair-tag">${h.maintenanceFrequency}</span>
              </div>
            </div>
          </div>`).join('')}
      </div>
      ${(hair.avoidHairstyles || []).length ? `
        <div class="ai-section-sub-label" style="color:var(--red);margin-top:24px">HAIRSTYLE TO AVOID</div>
        <div class="ai-photo-grid ai-photo-grid-3">
          ${(hair.avoidHairstyles || []).map(a => `
            <div class="ai-photo-card ai-photo-card-avoid">
              <div class="ai-photo-card-img-wrap">
                ${a.imageUrl ? `<img src="${a.imageUrl}" alt="${a.style}" class="ai-photo-card-img" loading="lazy" />` : '<div class="ai-photo-card-placeholder">🚫</div>'}
                <span class="ai-photo-avoid-x">✕</span>
              </div>
              <div class="ai-photo-card-body">
                <div class="ai-photo-card-name">${a.style}</div>
                <div class="ai-photo-card-why">${a.reason}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}
      ${hair.barberTip ? `<div class="ai-barber-tip">💈 ${hair.barberTip}</div>` : ''}`;

    const userPhoto = this.userPhotoUrl
      ? `<img class="ai-user-photo" src="${this.userPhotoUrl}" alt="Your photo" />`
      : '';

    container.innerHTML = `
      <div class="ai-full-results">

        <!-- User photo header -->
        ${userPhoto ? `<div class="ai-user-photo-header">
          <div class="ai-user-photo-wrap">${userPhoto}<span class="ai-user-photo-label">Your Photo</span></div>
          <div class="ai-user-summary">
            <div class="ai-user-summary-tag">${color.colorSeason || 'Autumn'} Type</div>
            <div class="ai-user-summary-tag">${outfit.faceShape || 'Oval'} Face</div>
            <div class="ai-user-summary-tag">${skincare.skinProfile?.type || 'Combination'} Skin</div>
            <div class="ai-user-summary-tag">${hair.currentHair?.texture || 'Straight'} Hair</div>
          </div>
        </div>` : ''}

        ${block('1', '🎨', 'Personal Color & Skin Analysis', colorHTML)}
        ${block('2', '👔', 'Outfit Recommendations', outfitHTML)}
        ${block('3', '🕶️', 'Eyewear Recommendations', eyewearHTML)}
        ${block('4', '✨', 'Skincare Routine', skincareHTML)}
        ${block('5', '💈', 'Hair Recommendations', hairHTML)}
      </div>`;
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
