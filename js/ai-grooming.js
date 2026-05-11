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
  async uploadImage(file, serviceType = 'face_analysis') {
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

    // Service type selection
    document.querySelectorAll('.ai-service-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.selectServiceType(e.target.dataset.service));
    });

    // Feature cards
    document.querySelectorAll('.ai-feature-card').forEach(card => {
      card.addEventListener('click', () => {
        const serviceType = card.dataset.service;
        this.scrollToUpload();
        this.selectServiceType(serviceType);
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
        analyzeBtn.textContent = 'Start AI Analysis';
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

  selectServiceType(type) {
    this.selectedService = type;
    
    // Update UI
    document.querySelectorAll('.ai-service-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.service === type) btn.classList.add('active');
    });

    // Show service description
    const descriptions = {
      face_analysis: 'Analyze your face shape, skin tone, and get personalized recommendations',
      hairstyle: 'Get 3 hairstyle recommendations based on your face shape',
      outfit: 'Color analysis and outfit recommendations for your skin tone',
      preview: 'Generate AI preview of your new look (uses 2 credits)'
    };

    const descEl = document.getElementById('ai-service-description');
    if (descEl) descEl.textContent = descriptions[type] || '';
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

    const serviceType = this.selectedService || 'face_analysis';
    
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
    
    const resultsContainer = document.getElementById('ai-results');
    if (!resultsContainer) return;

    resultsContainer.style.display = 'block';
    
    // Hide upload section
    const uploadSection = document.getElementById('ai-upload-section');
    if (uploadSection) uploadSection.style.display = 'none';

    // Render based on service type
    switch (results.serviceType) {
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
      loadingEl.querySelector('.ai-loading-text').textContent = message;
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
      analyzeBtn.textContent = 'Select Image First';
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
