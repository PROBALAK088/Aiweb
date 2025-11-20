import React, { useState, useRef, useEffect } from 'react';
import { Send, Image as ImageIcon, X, Trash2, Bot, User, Loader2, Sparkles, FileText, Mic, StopCircle, RefreshCw, Copy, Check, ChevronDown, Terminal, Lightbulb, Code2, Plane, BookOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChatResponse, fileToBase64 } from '../services/geminiService';
import { Message, BotModel, ChatConfig } from '../types';

const DEFAULT_SYSTEM_INSTRUCTION = "You are a helpful, clever, and friendly AI assistant named Gemini.";

declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

// --- Sub-component: Code Block with Copy ---
const CodeBlock = ({ language, value }: { language: string, value: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-4 rounded-lg overflow-hidden border border-slate-700/50 bg-slate-950 shadow-md">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800">
        <span className="text-xs font-mono text-indigo-400 flex items-center gap-1">
          <Terminal className="w-3 h-3" />
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="p-4 overflow-x-auto">
        <pre className="text-sm font-mono text-slate-300 leading-relaxed whitespace-pre">
          <code>{value}</code>
        </pre>
      </div>
    </div>
  );
};

export const ChatInterface: React.FC = () => {
  // State
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedTextFile, setSelectedTextFile] = useState<{ name: string; content: string } | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showModelSelect, setShowModelSelect] = useState(false);
  
  const [config, setConfig] = useState<ChatConfig>({
    model: BotModel.FLASH,
    systemInstruction: DEFAULT_SYSTEM_INSTRUCTION
  });

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Close model dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelSelect(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'inherit';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [inputValue]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedImage(file);
      const base64 = await fileToBase64(file);
      setImagePreview(base64);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleTextFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        const text = await file.text();
        setSelectedTextFile({ name: file.name, content: text });
      } catch (err) {
        console.error("Error reading text file:", err);
      }
      if (textFileInputRef.current) textFileInputRef.current.value = '';
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => setIsListening(true);
        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setInputValue((prev) => {
             const spacer = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
             return prev + spacer + transcript;
          });
        };
        recognition.onerror = () => setIsListening(false);
        recognition.onend = () => setIsListening(false);

        recognitionRef.current = recognition;
        recognition.start();
      } else {
        alert("Speech recognition is not supported in this browser.");
      }
    }
  };

  const clearAttachments = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setSelectedTextFile(null);
  };

  const processMessage = async (text: string, image: string | null | undefined, history: Message[]) => {
     // Create placeholder for AI response
    const aiMessageId = (Date.now() + 1).toString();
    const aiPlaceholder: Message = {
      id: aiMessageId,
      role: 'model',
      text: "",
      isStreaming: true,
      timestamp: Date.now()
    };
    
    setMessages(prev => [...prev, aiPlaceholder]);
    setIsStreaming(true);

    try {
      const stream = await streamChatResponse(
        history,
        text,
        image || null,
        config.model,
        config.systemInstruction
      );

      let fullText = "";
      
      for await (const chunk of stream) {
        const textChunk = chunk.text;
        if (textChunk) {
            fullText += textChunk;
            setMessages(prev => prev.map(msg => 
                msg.id === aiMessageId 
                ? { ...msg, text: fullText } 
                : msg
            ));
        }
      }
      
      setMessages(prev => prev.map(msg => 
        msg.id === aiMessageId 
        ? { ...msg, text: fullText, isStreaming: false } 
        : msg
      ));

    } catch (error: any) {
      setMessages(prev => prev.map(msg => 
        msg.id === aiMessageId 
        ? { ...msg, text: "Sorry, I encountered an error processing your request.", isError: true, isStreaming: false } 
        : msg
      ));
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSendMessage = async (overrideText?: string) => {
    const textToSend = overrideText !== undefined ? overrideText : inputValue;
    
    if ((!textToSend.trim() && !selectedImage && !selectedTextFile) || isStreaming) return;

    let userText = textToSend.trim();
    if (selectedTextFile) {
        userText = userText 
            ? `${userText}\n\n--- Attached File: ${selectedTextFile.name} ---\n${selectedTextFile.content}`
            : `--- Attached File: ${selectedTextFile.name} ---\n${selectedTextFile.content}`;
    }
    const userImage = imagePreview; 

    // UI Message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: textToSend.trim() || (selectedTextFile ? `Sent file: ${selectedTextFile.name}` : ''),
      image: userImage || undefined,
      timestamp: Date.now()
    };
    
    // We store the FULL context (with file content hidden from UI) for history
    const fullMessageForHistory = { ...userMessage, text: userText };

    setMessages(prev => [...prev, fullMessageForHistory]);
    setInputValue("");
    clearAttachments();
    if (textareaRef.current) textareaRef.current.style.height = 'inherit';

    // Trigger API
    await processMessage(userText, userImage, messages);
  };

  const handleRegenerate = async () => {
    if (isStreaming || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'model') return;

    // Remove the last model message
    const newHistory = messages.slice(0, -1);
    setMessages(newHistory);

    // Find the last user message to re-send
    const lastUserMessage = newHistory[newHistory.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== 'user') return;

    // We re-use the text from the history (which contains full context)
    await processMessage(lastUserMessage.text, lastUserMessage.image, newHistory.slice(0, -1));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Suggestion Chips
  const suggestions = [
    { icon: <Code2 className="w-4 h-4" />, label: "Write a Python script to parse JSON" },
    { icon: <Lightbulb className="w-4 h-4" />, label: "Explain Quantum Computing like I'm 5" },
    { icon: <BookOpen className="w-4 h-4" />, label: "Summarize the main themes of 1984" },
    { icon: <Plane className="w-4 h-4" />, label: "Plan a 3-day trip to Tokyo" },
  ];

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto w-full bg-slate-900/50 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-sm ring-1 ring-white/5">
      
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-slate-900/80 border-b border-slate-800 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="relative" ref={modelDropdownRef}>
            <h1 className="font-bold text-white leading-tight tracking-tight">Gemini Chat</h1>
            <button 
                onClick={() => setShowModelSelect(!showModelSelect)}
                className="text-xs text-slate-400 flex items-center gap-1.5 hover:text-indigo-400 transition-colors mt-0.5 px-1 -ml-1 rounded group"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${config.model.includes('flash') ? 'bg-amber-400' : 'bg-emerald-500'}`}></span>
              {config.model}
              <ChevronDown className="w-3 h-3 group-hover:translate-y-0.5 transition-transform" />
            </button>

            {/* Model Dropdown */}
            {showModelSelect && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Select Model</div>
                    {[
                        { id: BotModel.FLASH, name: 'Gemini 2.5 Flash', desc: 'Fast & Versatile' },
                        { id: BotModel.PRO, name: 'Gemini 2.5 Pro', desc: 'Complex Reasoning' },
                        { id: BotModel.LITE, name: 'Gemini 2.5 Flash Lite', desc: 'Speed Optimized' }
                    ].map((m) => (
                        <button
                            key={m.id}
                            onClick={() => {
                                setConfig({ ...config, model: m.id });
                                setShowModelSelect(false);
                            }}
                            className={`w-full text-left px-4 py-3 hover:bg-slate-700/50 transition-colors ${config.model === m.id ? 'bg-indigo-500/10 text-indigo-400' : 'text-slate-300'}`}
                        >
                            <div className="font-medium">{m.name}</div>
                            <div className="text-xs text-slate-500">{m.desc}</div>
                        </button>
                    ))}
                </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
            <button 
                onClick={() => setMessages([])}
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                title="Clear Chat"
            >
                <Trash2 className="w-5 h-5" />
            </button>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin relative">
        {messages.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 z-0">
             <div className="text-center space-y-6 max-w-2xl w-full animate-in fade-in zoom-in-95 duration-500">
                <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto ring-1 ring-slate-700 shadow-2xl">
                    <Bot className="w-10 h-10 text-indigo-400" />
                </div>
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-white">How can I help you today?</h2>
                    <p className="text-slate-400">I can help you write code, plan trips, or analyze images.</p>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 w-full max-w-lg mx-auto">
                    {suggestions.map((s, i) => (
                        <button 
                            key={i}
                            onClick={() => handleSendMessage(s.label)}
                            className="flex items-center gap-3 p-3 bg-slate-800/50 hover:bg-slate-800 border border-slate-700 hover:border-indigo-500/50 rounded-xl text-left text-sm text-slate-300 hover:text-white transition-all hover:-translate-y-0.5 group"
                        >
                            <span className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                                {s.icon}
                            </span>
                            <span className="line-clamp-1">{s.label}</span>
                        </button>
                    ))}
                </div>
             </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isLastMessage = idx === messages.length - 1;
            const isModel = msg.role === 'model';

            return (
            <div 
                key={msg.id} 
                className={`group flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
            >
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-md ${
                    msg.role === 'user' 
                    ? 'bg-indigo-600' 
                    : msg.isError ? 'bg-red-500/20' : 'bg-slate-700'
                }`}>
                    {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Sparkles className="w-4 h-4 text-indigo-300" />}
                </div>

                {/* Message Bubble */}
                <div className={`flex flex-col gap-2 max-w-[85%] min-w-[120px] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    
                    {/* Image Attachment */}
                    {msg.image && (
                        <div className="rounded-xl overflow-hidden border border-slate-700/50 shadow-lg max-w-xs">
                             <img 
                                src={`data:image/jpeg;base64,${msg.image}`} 
                                alt="Attachment" 
                                className="w-full h-auto object-cover"
                            />
                        </div>
                    )}

                    {/* Text Content */}
                    {(msg.text || msg.isStreaming) && (
                         <div className={`px-5 py-3.5 rounded-2xl text-sm leading-relaxed shadow-lg relative ${
                            msg.role === 'user'
                            ? 'bg-indigo-600 text-white rounded-tr-none'
                            : msg.isError 
                                ? 'bg-red-500/10 text-red-200 border border-red-500/20 rounded-tl-none'
                                : 'bg-slate-800 text-slate-200 border border-slate-700/50 rounded-tl-none'
                        }`}>
                            {msg.role === 'model' ? (
                                <ReactMarkdown 
                                    remarkPlugins={[remarkGfm]}
                                    className="prose prose-invert prose-sm max-w-none break-words [&>p]:mb-3 [&>p:last-child]:mb-0 [&>ul]:mb-3 [&>ol]:mb-3 [&_strong]:text-white [&_strong]:font-bold [&_em]:text-indigo-300 [&_em]:italic [&_a]:text-indigo-400 [&_a]:underline hover:[&_a]:text-indigo-300"
                                    components={{
                                        code({node, inline, className, children, ...props}: any) {
                                            const match = /language-(\w+)/.exec(className || '');
                                            const value = String(children).replace(/\n$/, '');
                                            if (!inline) {
                                                return <CodeBlock language={match?.[1] || ''} value={value} />;
                                            }
                                            return (
                                                <code className="bg-slate-950/50 border border-slate-700/50 px-1.5 py-0.5 rounded text-indigo-300 font-mono text-xs" {...props}>
                                                    {children}
                                                </code>
                                            );
                                        }
                                    }}
                                >
                                    {msg.text}
                                </ReactMarkdown>
                            ) : (
                                <div className="whitespace-pre-wrap">{msg.text}</div>
                            )}
                            
                            {msg.isStreaming && !msg.text && (
                                <div className="flex gap-1 py-1">
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot"></span>
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot"></span>
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot"></span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Actions for Model Message */}
                    {isModel && isLastMessage && !isStreaming && !msg.isError && (
                        <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                                onClick={handleRegenerate}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-400 hover:text-white transition-all"
                            >
                                <RefreshCw className="w-3 h-3" />
                                Regenerate
                            </button>
                        </div>
                    )}
                </div>
            </div>
          )})
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-slate-900 border-t border-slate-800 z-20">
        {/* Attachments Preview */}
        {(imagePreview || selectedTextFile) && (
            <div className="mb-3 flex flex-wrap items-start gap-2 animate-in slide-in-from-bottom-2 fade-in duration-200">
                {imagePreview && (
                    <div className="relative group">
                        <img src={`data:image/jpeg;base64,${imagePreview}`} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-slate-700" />
                        <button 
                            onClick={() => { setImagePreview(null); setSelectedImage(null); }}
                            className="absolute -top-2 -right-2 bg-slate-800 text-slate-400 hover:text-red-400 rounded-full p-1 border border-slate-700 shadow-sm"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                )}
                {selectedTextFile && (
                    <div className="relative group flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg p-2 pr-3 shadow-sm">
                        <div className="bg-indigo-500/20 p-1.5 rounded">
                            <FileText className="w-5 h-5 text-indigo-400" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-xs font-medium text-slate-300 truncate max-w-[150px]">{selectedTextFile.name}</span>
                            <span className="text-[10px] text-slate-500">Text File</span>
                        </div>
                        <button 
                            onClick={() => setSelectedTextFile(null)}
                            className="ml-2 text-slate-500 hover:text-red-400"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>
        )}
        
        <div className="flex items-end gap-2 bg-slate-800 rounded-xl p-2 border border-slate-700 focus-within:border-indigo-500/50 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all shadow-inner">
           {/* Image Input */}
           <input 
             type="file" 
             ref={fileInputRef}
             onChange={handleImageSelect}
             className="hidden"
             accept="image/jpeg, image/png, image/webp"
           />
           <button 
             onClick={() => fileInputRef.current?.click()}
             className={`p-2.5 rounded-lg transition-colors flex-shrink-0 ${
                imagePreview ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-700'
             }`}
             title="Attach Image"
           >
             <ImageIcon className="w-5 h-5" />
           </button>

           {/* Text File Input */}
           <input 
             type="file" 
             ref={textFileInputRef}
             onChange={handleTextFileSelect}
             className="hidden"
             accept=".txt,.md,.py,.js,.json,.csv,.html,.css"
           />
           <button 
             onClick={() => textFileInputRef.current?.click()}
             className={`p-2.5 rounded-lg transition-colors flex-shrink-0 ${
                selectedTextFile ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-700'
             }`}
             title="Attach Text File"
           >
             <FileText className="w-5 h-5" />
           </button>

           <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Gemini..."
              className="flex-1 bg-transparent text-white text-sm placeholder:text-slate-500 focus:outline-none py-2.5 max-h-[150px] resize-none overflow-y-auto"
              rows={1}
           />

           {/* Voice Input */}
           <button
             onClick={toggleListening}
             className={`p-2.5 rounded-lg transition-all flex-shrink-0 ${
                isListening 
                 ? 'text-red-400 bg-red-500/10 animate-pulse ring-1 ring-red-500/50' 
                 : 'text-slate-400 hover:text-white hover:bg-slate-700'
             }`}
             title={isListening ? "Stop Recording" : "Voice Input"}
           >
             {isListening ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
           </button>

           <button
             onClick={() => handleSendMessage()}
             disabled={(!inputValue.trim() && !selectedImage && !selectedTextFile) || isStreaming}
             className={`p-2.5 rounded-lg flex-shrink-0 transition-all ${
                (!inputValue.trim() && !selectedImage && !selectedTextFile) || isStreaming
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 active:scale-95'
             }`}
           >
             {isStreaming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
           </button>
        </div>
        <p className="text-center text-[10px] text-slate-600 mt-2">
            Gemini can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
};