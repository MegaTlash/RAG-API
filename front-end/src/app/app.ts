// MODIFIED: Import necessary tools for platform detection and AfterViewInit
import { Component, AfterViewInit, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { marked } from 'marked';

// Interfaces remain the same
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
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})

// MODIFIED: Implement AfterViewInit instead of OnInit for DOM safety
export class App implements AfterViewInit {
  // --- DOM Element Properties ---
  // These will be assigned in ngAfterViewInit now
  private messagesContainer!: HTMLElement;
  private userInput!: HTMLInputElement;
  private sendButton!: HTMLElement;
  private newChatButton!: HTMLElement;
  private clearHistoryButton!: HTMLElement;
  private toggleThemeButton!: HTMLElement;
  private chatHistoryContainer!: HTMLElement;
  private currentChatTitle!: HTMLElement;
  // ... other element properties

  // --- API Configuration ---

  // --- State Properties ---
  private currentChatId: string | null = null;
  private isTyping = false;
  private stopGeneration = false;
  private chatHistory: ChatHistory = {};
  private currentTheme: 'light' | 'dark' = 'light';
  private pendingFile: File | null = null;

  // MODIFIED: Inject PLATFORM_ID to detect the environment
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  /**
   * ngAfterViewInit runs only after the component's view has been initialized.
   * It's the safest place for DOM manipulation.
   */
  ngAfterViewInit(): void {
    // MODIFIED: The CRITICAL fix. This code will now ONLY run in the browser.
    if (isPlatformBrowser(this.platformId)) {
      // --- All your DOM-related initialization code goes inside this block ---

      // 1. Query and Assign DOM Elements
      this.messagesContainer = document.getElementById('messages')!;
      this.userInput = document.getElementById('user-input') as HTMLInputElement;
      this.sendButton = document.getElementById('send-button')!;
      this.newChatButton = document.getElementById('new-chat')!;
      this.clearHistoryButton = document.getElementById('clear-history')!;
      this.toggleThemeButton = document.getElementById('toggle-theme')!;
      this.chatHistoryContainer = document.getElementById('chat-history')!;
      this.currentChatTitle = document.getElementById('current-chat-title')!;
      // ... query other elements here

      // 2. Attach Event Listeners
      this.sendButton.addEventListener('click', () => this.sendMessage());
      this.userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          this.sendMessage();
        }
      });
      this.newChatButton.addEventListener('click', () => this.startNewChat());
      this.clearHistoryButton.addEventListener('click', () => this.clearAllHistory());
      this.toggleThemeButton.addEventListener('click', () => this.toggleTheme());
      // ... attach other listeners here

      // 3. Initialize Application State that depends on browser APIs (like localStorage)
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
  }

  // ALL OTHER METHODS (sendMessage, loadChat, etc.) remain exactly the same as before.
  // ... Paste all your other methods from the previous code block here ...
  // (The following methods are unchanged from the previous version)

  private loadStateFromLocalStorage(): void {
    const savedHistory = localStorage.getItem('chatHistory');
    this.chatHistory = savedHistory ? JSON.parse(savedHistory) : {};

    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    this.currentTheme = savedTheme || 'light';
  }

  private async addMessageToUI(message: Message): Promise<void> {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', message.role);

    const contentWrapper = document.createElement('div');
    contentWrapper.classList.add('message-content');
    contentWrapper.innerHTML = await this.getStableRendering(message.content);
    messageElement.appendChild(contentWrapper);

    this.messagesContainer.appendChild(messageElement);
    this.scrollToBottom();
  }

  //Streaming response from AI instead of all at once
  /*
  private async sendMessage(): Promise<void> {
    const userMessageContent = this.userInput.value.trim();
    if (!userMessageContent || this.isTyping) {
      return;
    }

    const userMessage: Message = { role: 'user', content: userMessageContent };
    this.addMessageToUI(userMessage);
    this.getCurrentChatMessages().push(userMessage);
    this.userInput.value = '';

    const assistantMessage: Message = { role: 'assistant', content: '' };
    this.addMessageToUI(assistantMessage);
    const assistantMessageElement = this.messagesContainer.lastChild as HTMLElement;
    const assistantContentElement = assistantMessageElement.querySelector('.message-content')!;

    this.isTyping = true;
    this.stopGeneration = false;

    try {
      const response = await fetch('http://localhost:8000/query', {
        method: 'POST',
        body: JSON.stringify({
            query: this.getCurrentChatMessages(),
          }),
        }
      );

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
                assistantContentElement.innerHTML = await this.getStableRendering(fullResponse);
                this.scrollToBottom();
              }
            } catch (error) {
              // Ignore parsing errors
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
  */
  
  private async sendMessage(): Promise<void> {
    const userMessageContent = this.userInput.value.trim();
    if (!userMessageContent || this.isTyping) {
      return;
    }

    // Add user message to the UI
    const userMessage: Message = { role: 'user', content: userMessageContent };
    this.addMessageToUI(userMessage);
    this.getCurrentChatMessages().push(userMessage);
    this.userInput.value = '';

    // Add a placeholder for the assistant's response
    const assistantMessage: Message = { role: 'assistant', content: '' };
    this.addMessageToUI(assistantMessage);
    const assistantMessageElement = this.messagesContainer.lastChild as HTMLElement;
    const assistantContentElement = assistantMessageElement.querySelector('.message-content')!;
    assistantContentElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; // Loading indicator

    this.isTyping = true;

    try {
      // MODIFIED: Fetch call now points to your local model
      const response = await fetch('http://localhost:8000/query', {
        method: 'POST',
        headers: {
          // NEW: Added a Content-Type header for JSON
          'Content-Type': 'application/json',
        },
        // MODIFIED: The body now sends only the latest user message content
        body: JSON.stringify({
          query: userMessageContent,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // NEW: Handle a standard JSON response instead of a stream
      const data = await response.json();

      // IMPORTANT: Adjust 'data.response' to match your API's output.
      // It might be data.answer, data.result, or just data itself.
      const fullResponse = data.result || 'No response found.';
      
      assistantMessage.content = fullResponse;
      assistantContentElement.innerHTML = await this.getStableRendering(fullResponse);
      this.getCurrentChatMessages().push(assistantMessage);

    } catch (error) {
      console.error('API Error:', error);
      const errorMessage = 'Sorry, an error occurred while contacting the local model.';
      assistantContentElement.innerHTML = errorMessage;
      assistantMessage.content = errorMessage;
      this.getCurrentChatMessages().push(assistantMessage);
    } finally {
      this.isTyping = false;
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
    this.chatHistory[chatId].messages.forEach(msg => this.addMessageToUI(msg));
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
    if (this.toggleThemeButton) {
      this.toggleThemeButton.innerHTML =
        this.currentTheme === 'dark'
          ? '<i class="fas fa-sun"></i><span>Light Mode</span>'
          : '<i class="fas fa-moon"></i><span>Dark Mode</span>';
    }
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

  private async getStableRendering(text: string): Promise<string> {
    const parts = text.split('```');
    if (parts.length % 2 === 1) {
      return await marked.parse(text) as string;
    } else {
      const closedPart = parts.slice(0, -1).join('```');
      const openPart = parts[parts.length - 1];
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