const API_BASE_URL = '/api';

export async function fetchTokens() {
    try {
        const response = await fetch(`${API_BASE_URL}/tokens`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching tokens:', error);
        throw error;
    }
}

export async function switchToken(index) {
    try {
        const response = await fetch(`${API_BASE_URL}/tokens/${index}`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            // Get the error message from the response if available
            let errorMessage;
            try {
                const errorData = await response.json();
                // Handle GitHub API specific error format
                if (errorData.error_details) {
                    errorMessage = errorData.error_details.message || errorData.message;
                } else {
                    errorMessage = errorData.message || `Failed with status: ${response.status}`;
                }
            } catch {
                errorMessage = `HTTP error! status: ${response.status}`;
            }

            // If this token fails, automatically try the next one
            const tokens = await fetchTokens();
            const currentIndex = tokens.findIndex(t => t.index === index);
            
            // Only try next token if it exists and isn't already marked as failed
            if (currentIndex >= 0 && currentIndex < tokens.length - 1 && 
                !tokens[currentIndex + 1].error_message) {
                console.log(`Token ${index} failed, trying next token...`);
                return await switchToken(tokens[currentIndex + 1].index);
            }
            
            throw new Error(errorMessage);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error switching token:', error);
        throw error;
    }
}

// Parse GitHub API error details
export function parseGitHubError(error) {
    try {
        const data = typeof error === 'string' ? JSON.parse(error) : error;
        if (data.error_details) {
            return {
                message: data.error_details.message || data.message,
                url: data.error_details.url || null,
                title: data.error_details.title || 'Error'
            };
        }
        return {
            message: data.message || 'Unknown error',
            url: null,
            title: 'Error'
        };
    } catch {
        return {
            message: String(error),
            url: null,
            title: 'Error'
        };
    }
}