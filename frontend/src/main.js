import { fetchTokens, switchToken, parseGitHubError } from './api/tokens.js';

class DashboardApp {
    constructor() {
        this.tokens = [];
        this.tokensContainer = document.getElementById('tokens-container');
        this.tokenTemplate = document.getElementById('token-template');
        this.refreshIndicator = document.querySelector('.refresh-indicator');
        this.updateInterval = 30000; // 30 seconds
        this.initialize();
    }

    async initialize() {
        try {
            await this.loadTokens();
            this.startPeriodicUpdates();
        } catch (error) {
            console.error('Failed to initialize dashboard:', error);
            // Show error state in the dashboard instead of crashing
            this.showInitializationError(error);
        }
    }

    showInitializationError(error) {
        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.textContent = `Dashboard initialization failed: ${error.message}. Retrying...`;
        this.tokensContainer.appendChild(errorMessage);
        
        // Retry initialization after a delay
        setTimeout(() => this.loadTokens(), 5000);
    }

    async loadTokens() {
        try {
            this.setUpdatingStatus(true);
            this.tokens = await fetchTokens();
            
            // Check for any banned/failed tokens and try to switch if current token is failed
            const currentToken = this.tokens.find(t => t.is_current);
            if (currentToken && currentToken.status.toLowerCase() === 'error') {
                const nextValidToken = this.tokens.find(t => 
                    t.index > currentToken.index && 
                    t.status.toLowerCase() !== 'error'
                );
                
                if (nextValidToken) {
                    console.log(`Current token failed, switching to token ${nextValidToken.index}`);
                    await this.handleTokenSwitch(nextValidToken.index);
                    return;
                }
            }
            
            this.renderTokens();
        } catch (error) {
            console.error('Error loading tokens:', error);
            this.showLoadError(error);
        } finally {
            this.setUpdatingStatus(false);
        }
    }

    showLoadError(error) {
        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        const errorDetails = parseGitHubError(error);
        errorMessage.textContent = `Failed to load tokens: ${errorDetails.message}`;
        this.tokensContainer.innerHTML = '';
        this.tokensContainer.appendChild(errorMessage);
    }

    renderTokens() {
        this.tokensContainer.innerHTML = '';
        this.tokens.forEach(token => this.renderToken(token));
    }

    renderToken(token) {
        const tokenElement = this.tokenTemplate.content.cloneNode(true);
        
        const tokenItem = tokenElement.querySelector('.token-item');
        tokenItem.dataset.tokenId = token.id;
        tokenItem.dataset.tokenIndex = token.index;
        if (token.is_current) {
            tokenItem.classList.add('current');
        }

        const tokenId = tokenElement.querySelector('.token-id');
        tokenId.textContent = `Token ${token.index}`;

        const tokenStatus = tokenElement.querySelector('.token-status');
        this.updateTokenStatus(tokenStatus, token);

        const expirationValue = tokenElement.querySelector('.expiration .value');
        expirationValue.textContent = this.formatExpiration(token.expiration);

        const switchButton = tokenElement.querySelector('.switch-button');
        if (!token.is_current && token.status.toLowerCase() !== 'error') {
            switchButton.addEventListener('click', () => this.handleTokenSwitch(token.index));
        } else if (token.status.toLowerCase() === 'error') {
            switchButton.disabled = true;
            switchButton.title = 'Token unavailable';
        }

        // Add error details if present
        if (token.error_message) {
            const errorDetails = parseGitHubError(token.error_message);
            const errorContainer = document.createElement('div');
            errorContainer.className = 'token-error';
            errorContainer.textContent = errorDetails.message;
            if (errorDetails.url) {
                const link = document.createElement('a');
                link.href = errorDetails.url;
                link.textContent = errorDetails.title;
                link.target = '_blank';
                errorContainer.appendChild(document.createElement('br'));
                errorContainer.appendChild(link);
            }
            tokenItem.appendChild(errorContainer);
        }

        this.tokensContainer.appendChild(tokenElement);
    }

    async handleTokenSwitch(index) {
        try {
            this.setUpdatingStatus(true);
            await switchToken(index);
            await this.loadTokens(); // Reload all tokens to update UI
        } catch (error) {
            console.error('Error switching token:', error);
            const errorDetails = parseGitHubError(error);
            const tokenElement = this.tokensContainer.querySelector(`[data-token-index="${index}"]`);
            if (tokenElement) {
                const statusElement = tokenElement.querySelector('.token-status');
                this.updateTokenStatus(statusElement, {
                    status: 'error',
                    error_message: errorDetails.message
                });
            }
        } finally {
            this.setUpdatingStatus(false);
        }
    }

    updateTokenStatus(statusElement, token) {
        statusElement.className = 'token-status';
        
        switch (token.status.toLowerCase()) {
            case 'active':
                statusElement.textContent = 'Active';
                statusElement.classList.add('success');
                break;
            case 'inactive':
                statusElement.textContent = 'Inactive';
                statusElement.classList.add('inactive');
                break;
            case 'error':
                const errorDetails = token.error_message ? parseGitHubError(token.error_message) : { message: 'Error' };
                statusElement.textContent = errorDetails.message;
                statusElement.classList.add('error');
                if (errorDetails.url) {
                    statusElement.title = `${errorDetails.title} - Click for more info`;
                    statusElement.style.cursor = 'help';
                }
                break;
            default:
                statusElement.textContent = token.status;
                if (token.error_message) {
                    statusElement.classList.add('error');
                }
                break;
        }
    }

    formatExpiration(expiration) {
        const expirationDate = new Date(expiration);
        const now = new Date();
        const diffTime = expirationDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
            return 'Expired';
        } else if (diffDays === 0) {
            return 'Today';
        } else if (diffDays === 1) {
            return 'Tomorrow';
        } else {
            return `In ${diffDays} days`;
        }
    }

    setUpdatingStatus(isUpdating) {
        if (isUpdating) {
            this.refreshIndicator.classList.add('updating');
        } else {
            this.refreshIndicator.classList.remove('updating');
        }
    }

    startPeriodicUpdates() {
        setInterval(() => this.loadTokens(), this.updateInterval);
    }
}

// Initialize the dashboard when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new DashboardApp();
});