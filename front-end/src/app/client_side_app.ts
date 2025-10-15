import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { marked } from 'marked';

// Define interfaces for type safety
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatHistory {
  [chatId: string]: {
    title: string;
    messages: Message[];
  };
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})

export class App implements OnInit  {
  // --- DOM Element Properties ---
  private messagesContainer!: HTMLElement;
  private userInput!: HTMLInputElement;
  private sendButton!: HTMLElement;
  private newChatButton!: HTMLElement;
  private clearHistoryButton!: HTMLElement;
  private toggleThemeButton!: HTMLElement;
  private chatHistoryContainer!: HTMLElement;
  private currentChatTitle!: HTMLElement;
  private exportChatButton!: HTMLElement;
  private regenerateResponseButton!: HTMLElement;
  private stopResponseButton!: HTMLElement;
  private suggestionChips!: NodeListOf<HTMLElement>;
  private fileUploadButton!: HTMLElement;
  private fileUploadInput!: HTMLInputElement;


   // --- API Configuration ---
   private readonly API_KEY = "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";

   // --- State Properties ---
   private currentChatId: string | null = null;
   private isTyping = false;
   private stopGeneration = false;
   private chatHistory: ChatHistory = {};
   private currentTheme: 'light' | 'dark' = 'light';
   private pendingFile: File | null = null;

   ngOnInit(): void {
      // Query and Assign DOM Elements
      this.messagesContainer = document.getElementById('messages')!;
      this.userInput = document.getElementById('user-input') as HTMLInputElement;
      this.sendButton = document.getElementById('send-button')!;
      this.newChatButton = document.getElementById('new-chat')!;
      this.clearHistoryButton = document.getElementById('clear-history')!;
      this.toggleThemeButton = document.getElementById('toggle-theme')!;
      this.chatHistoryContainer = document.getElementById('chat-history')!;
      this.currentChatTitle = document.getElementById('current-chat-title')!;
      this.exportChatButton = document.getElementById('export-chat')!;
      this.regenerateResponseButton = document.getElementById('regenerate-response')!;
      this.stopResponseButton = document.getElementById('stop-response')!;
      this.suggestionChips = document.querySelectorAll('.suggestion-chip');
      this.fileUploadButton = document.getElementById('file-upload-button')!;
      this.fileUploadInput = document.getElementById('file-upload') as HTMLInputElement;

      // Attach Event Listeners
      this.sendButton.addEventListener('click', () => this.sendMessage());
      this.userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          this.sendMessage();
        }
      });
      this.newChatButton.addEventListener('click', () => this.startNewChat());
      this.clearHistoryButton.addEventListener('click', () => this.clearAllHistory());
      this.toggleThemeButton.addEventListener('click', () => this.toggleTheme());
      this.stopResponseButton.addEventListener('click', () => this.stopResponse());
      this.suggestionChips.forEach(chip => {
        chip.addEventListener('click', () => {
          if (chip.textContent) {
            this.userInput.value = chip.textContent;
          }
          this.sendMessage();
        });
      });

    // Initialize Application State
    this.loadStateFromLocalStorage();
    this.applyTheme();
    this.renderChatHistory();

    const lastChatId = localStorage.getItem('currentChatId');
    if (lastChatId && this.chatHistory[lastChatId]) {
      this.loadChat(lastChatId);
    } else {
      this.startNewChat();
    }
    
  }

  private loadStateFromLocalStorage(): void {
    const savedHistory = localStorage.getItem('chatHistory');
    this.chatHistory = savedHistory ? JSON.parse(savedHistory) : {};

    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    this.currentTheme = savedTheme || 'light';
  }

  // MODIFIED: Added 'async' keyword
  private async addMessageToUI(message: Message): Promise<void> {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', message.role);
    
    const contentWrapper = document.createElement('div');
    contentWrapper.classList.add('message-content');
    // MODIFIED: Added 'await' keyword
    contentWrapper.innerHTML = await this.getStableRendering(message.content);
    messageElement.appendChild(contentWrapper);
    
    this.messagesContainer.appendChild(messageElement);
    this.scrollToBottom();
  }

  private async sendMessage(): Promise<void> {
    const userMessageContent = this.userInput.value.trim();
    if (!userMessageContent || this.isTyping) {
      return;
    }

    const userMessage: Message = { role: 'user', content: userMessageContent };
    this.addMessageToUI(userMessage); // This will now run asynchronously
    this.getCurrentChatMessages().push(userMessage);
    this.userInput.value = '';

    const assistantMessage: Message = { role: 'assistant', content: '' };
    this.addMessageToUI(assistantMessage);
    const assistantMessageElement = this.messagesContainer.lastChild as HTMLElement;
    const assistantContentElement = assistantMessageElement.querySelector('.message-content')!;

    this.isTyping = true;
    this.stopGeneration = false;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-3.5-turbo',
          messages: this.getCurrentChatMessages(),
          stream: true,
        }),
      });

      if (!response.body) throw new Error('Response body is missing.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullResponse = '';

      while (true) {
        if (this.stopGeneration) {
          reader.cancel();
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const content = line.substring(6);
            if (content === '[DONE]') break;
            try {
              const json = JSON.parse(content);
              const delta = json.choices[0]?.delta?.content || '';
              if (delta) {
                fullResponse += delta;
                // MODIFIED: Added 'await' keyword
                assistantContentElement.innerHTML = await this.getStableRendering(fullResponse);
                this.scrollToBottom();
              }
            } catch (error) {
              // Ignore parsing errors for incomplete JSON
            }
          }
        }
      }
      assistantMessage.content = fullResponse;
      this.getCurrentChatMessages().push(assistantMessage);
    } catch (error) {
      console.error('API Error:', error);
      const errorMessage = 'Sorry, an error occurred. Please try again.';
      assistantContentElement.innerHTML = errorMessage;
      assistantMessage.content = errorMessage;
      this.getCurrentChatMessages().push(assistantMessage);
    } finally {
      this.isTyping = false;
      this.stopGeneration = false;
      this.saveCurrentChat();
      this.renderChatHistory();
    }
  }

  private startNewChat(): void {
    this.currentChatId = `chat_${Date.now()}`;
    this.chatHistory[this.currentChatId] = { title: 'New Chat', messages: [] };
    localStorage.setItem('currentChatId', this.currentChatId);
    this.messagesContainer.innerHTML = '';
    this.updateChatTitle('New Chat');
  }

  private loadChat(chatId: string): void {
    if (!this.chatHistory[chatId]) return;

    this.currentChatId = chatId;
    localStorage.setItem('currentChatId', chatId);
    this.messagesContainer.innerHTML = '';
    this.chatHistory[chatId].messages.forEach(msg => this.addMessageToUI(msg)); // Renders messages one by one
    this.updateChatTitle(this.chatHistory[chatId].title);
  }

  private clearAllHistory(): void {
    if (confirm('Are you sure you want to clear all history?')) {
      this.chatHistory = {};
      localStorage.removeItem('chatHistory');
      localStorage.removeItem('currentChatId');
      this.renderChatHistory();
      this.startNewChat();
    }
  }

  private renderChatHistory(): void {
    this.chatHistoryContainer.innerHTML = '';
    Object.keys(this.chatHistory).forEach(id => {
      const chatItem = document.createElement('div');
      chatItem.classList.add('chat-history-item');
      chatItem.textContent = this.chatHistory[id].title;
      chatItem.addEventListener('click', () => this.loadChat(id));
      this.chatHistoryContainer.appendChild(chatItem);
    });
  }

  private toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', this.currentTheme);
    this.applyTheme();
  }

  private applyTheme(): void {
    document.body.classList.toggle('dark-mode', this.currentTheme === 'dark');
    this.toggleThemeButton.innerHTML =
      this.currentTheme === 'dark'
        ? '<i class="fas fa-sun"></i><span>Light Mode</span>'
        : '<i class="fas fa-moon"></i><span>Dark Mode</span>';
  }

  private stopResponse(): void {
    this.stopGeneration = true;
  }
  
  private saveCurrentChat(): void {
    if (!this.currentChatId) return;
    
    const chat = this.chatHistory[this.currentChatId];
    if (chat) {
        if (chat.title === 'New Chat' && chat.messages.length > 0) {
            const firstUserMessage = chat.messages.find(m => m.role === 'user');
            if (firstUserMessage) {
              chat.title = firstUserMessage.content.substring(0, 30);
              this.updateChatTitle(chat.title);
            }
        }
    }
    localStorage.setItem('chatHistory', JSON.stringify(this.chatHistory));
  }

  // MODIFIED: Function is now async and returns a Promise<string>
  private async getStableRendering(text: string): Promise<string> {
    const parts = text.split('```');
    if (parts.length % 2 === 1) {
      // MODIFIED: Added 'await'
      return await marked.parse(text) as string;
    } else {
      const closedPart = parts.slice(0, -1).join('```');
      const openPart = parts[parts.length - 1];
      // MODIFIED: Added 'await' to both calls
      const parsedClosed = await marked.parse(closedPart) as string;
      const parsedOpen = await marked.parse('```' + openPart + '\n```') as string;
      return parsedClosed + parsedOpen;
    }
  }

  private updateChatTitle(title: string): void {
    if (this.currentChatTitle) {
        this.currentChatTitle.textContent = title;
    }
  }

  private getCurrentChatMessages(): Message[] {
    return this.currentChatId ? this.chatHistory[this.currentChatId].messages : [];
  }

  private scrollToBottom(): void {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}
