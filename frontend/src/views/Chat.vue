<template>
  <div class="flex h-screen bg-slate-900 text-slate-100 overflow-hidden font-sans">
    <!-- Sidebar -->
    <aside class="w-72 border-r border-slate-700 bg-slate-900 flex flex-col shrink-0 z-20">
      <div class="p-4 border-b border-slate-700 font-bold text-slate-300 tracking-wide uppercase text-xs flex justify-between items-center">
        <span>Settings</span>
        <span class="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-blue-400 border border-slate-700">{{ currentModelType }} mode</span>
      </div>
      
      <div class="flex-1 overflow-y-auto p-5 space-y-8 custom-scrollbar">
        
        <!-- TEXT MODE SETTINGS -->
        <template v-if="currentModelType === 'text'">
            <!-- Thinking Config -->
            <div class="space-y-4">
               <div class="flex items-center justify-between">
                  <div class="flex flex-col">
                      <label class="text-sm font-medium text-slate-200">Thinking Mode</label>
                      <span class="text-xs text-slate-500">For reasoning models</span>
                  </div>
                  <div class="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                    <input type="checkbox" v-model="params.thinking.enabled" class="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer outline-none"/>
                    <label class="toggle-label block overflow-hidden h-5 rounded-full bg-slate-700 cursor-pointer"></label>
                  </div>
               </div>
               
               <div v-if="params.thinking.enabled" class="space-y-4 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 animate-in fade-in slide-in-from-top-2">
                  <div>
                    <label class="text-xs text-slate-400 font-medium block mb-1.5">Budget (tokens)</label>
                    <input type="number" v-model="params.thinking.budget" step="1024" min="1024" class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs focus:border-blue-500 outline-none transition-colors">
                  </div>
                  <div class="flex items-center justify-between">
                     <label class="text-xs text-slate-400 font-medium">Include Thoughts</label>
                     <input type="checkbox" v-model="params.thinking.includeThoughts" class="accent-blue-500 w-4 h-4 rounded border-slate-600 bg-slate-700">
                  </div>
               </div>
            </div>

            <div class="h-px bg-slate-800"></div>

            <div class="space-y-6">
              <div>
                <div class="flex justify-between mb-2">
                  <label class="text-xs font-medium text-slate-400">Temperature</label>
                  <span class="text-xs font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{{ params.temperature }}</span>
                </div>
                <input 
                  type="range" min="0" max="2" step="0.1" 
                  v-model.number="params.temperature"
                  :disabled="params.thinking.enabled"
                  class="w-full accent-blue-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
              </div>

              <div>
                <div class="flex justify-between mb-2">
                  <label class="text-xs font-medium text-slate-400">Top P</label>
                  <span class="text-xs font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{{ params.topP }}</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.05" 
                  v-model.number="params.topP"
                  class="w-full accent-blue-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                >
              </div>

              <div>
                <label class="text-xs font-medium text-slate-400 block mb-1.5">Max Tokens</label>
                <input 
                  type="number" 
                  v-model.number="params.maxTokens"
                  placeholder="Default"
                  class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none transition-colors placeholder:text-slate-600"
                >
              </div>

              <div class="flex items-center justify-between pt-2">
                 <label class="text-sm font-medium text-slate-300">Stream Response</label>
                 <div class="relative inline-block w-10 align-middle select-none transition duration-200 ease-in">
                    <input type="checkbox" v-model="params.stream" class="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer outline-none"/>
                    <label class="toggle-label block overflow-hidden h-5 rounded-full bg-slate-700 cursor-pointer"></label>
                  </div>
              </div>
            </div>
        </template>

        <!-- AUDIO MODE SETTINGS -->
        <template v-else-if="currentModelType === 'audio'">
             <div class="space-y-6">
                <div>
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Voice Sample</label>
                   <select v-model="audioParams.voiceSample" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                      <option :value="undefined">Default</option>
                      <option v-for="v in voices" :key="v.name" :value="v.name">{{ v.name }}</option>
                   </select>
                </div>

                <div>
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Language</label>
                   <select v-model="audioParams.languageId" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                      <option value="en">English (en)</option>
                      <option value="ru">Russian (ru)</option>
                      <option value="es">Spanish (es)</option>
                      <option value="fr">French (fr)</option>
                      <option value="de">German (de)</option>
                      <option value="ja">Japanese (ja)</option>
                      <option value="zh">Chinese (zh)</option>
                   </select>
                </div>

                <div>
                    <div class="flex justify-between mb-2">
                      <label class="text-xs font-medium text-slate-400">Exaggeration (Emotion)</label>
                      <span class="text-xs font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{{ audioParams.exaggeration }}</span>
                    </div>
                    <input 
                      type="range" min="0" max="2" step="0.1" 
                      v-model.number="audioParams.exaggeration"
                      class="w-full accent-purple-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                    >
                    <p class="text-[10px] text-slate-600 mt-1">Higher = more expressive/unstable</p>
                </div>

                <div>
                    <div class="flex justify-between mb-2">
                      <label class="text-xs font-medium text-slate-400">CFG (Stability/Tempo)</label>
                      <span class="text-xs font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{{ audioParams.cfg }}</span>
                    </div>
                    <input 
                      type="range" min="0" max="2" step="0.1" 
                      v-model.number="audioParams.cfg"
                      class="w-full accent-teal-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                    >
                     <p class="text-[10px] text-slate-600 mt-1">Lower = faster. 0.5 is standard.</p>
                </div>
             </div>
        </template>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col min-w-0">
      <Header>
        <template #actions>
           <div class="flex items-center gap-3">
            <span class="text-xs font-medium text-slate-500 uppercase tracking-wider">Model</span>
            <select 
              v-model="selectedModel" 
              class="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all min-w-[200px] max-w-[300px] truncate shadow-sm"
            >
              <option v-if="loadingModels" disabled>Loading...</option>
              <option v-for="model in models" :key="model.id" :value="model.id">
                {{ model.id }}
              </option>
            </select>
           </div>
        </template>
      </Header>

      <!-- CONTENT AREA -->
      <div class="flex-1 relative flex flex-col min-h-0 bg-slate-900">
         
         <!-- TEXT CHAT MODE -->
         <template v-if="currentModelType === 'text'">
             <!-- Messages List -->
             <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar pb-32">
                <div v-if="messages.length === 0" class="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                    <div class="p-6 rounded-2xl bg-slate-800/30 border border-slate-800 shadow-xl">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-slate-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <p class="text-lg font-medium text-slate-400 text-center">Ready to chat</p>
                    </div>
                </div>

                <div 
                    v-for="(msg, index) in messages" 
                    :key="index"
                    :class="['flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300', msg.role === 'user' ? 'justify-end' : 'justify-start']"
                >
                    <div 
                    :class="[
                        'max-w-[85%] rounded-2xl px-5 py-3 text-sm leading-7 shadow-md break-words',
                        msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : (msg.isError ? 'bg-red-900/40 text-red-200 border border-red-800' : 'bg-slate-800 text-slate-200 border border-slate-700/80') + ' rounded-tl-none'
                    ]"
                    >
                    <div v-if="msg.role === 'assistant' && msg.content === '' && !msg.isError" class="flex items-center gap-2 text-slate-400 italic">
                        <span class="animate-pulse">Generating response...</span>
                    </div>
                    <div class="whitespace-pre-wrap font-light tracking-wide">{{ msg.content }}</div>
                    </div>
                </div>
             </div>

             <!-- Input Area -->
             <div class="p-4 bg-slate-900 border-t border-slate-800/50 absolute bottom-0 left-0 right-0 z-10 backdrop-blur-md bg-opacity-95">
                <div class="max-w-4xl mx-auto relative group">
                    <textarea
                        v-model="input"
                        @keydown.enter.prevent="sendMessage"
                        placeholder="Type your message..."
                        class="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 pr-24 text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none resize-none min-h-[60px] max-h-[200px] shadow-lg transition-all text-slate-200 placeholder:text-slate-600"
                        :disabled="isGenerating"
                    ></textarea>
                    
                    <div class="absolute bottom-3 right-3 flex items-center gap-2">
                        <button 
                            @click="sendMessage"
                            :disabled="!input.trim() || isGenerating"
                            class="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white p-2 rounded-lg transition-all shadow-md flex items-center justify-center"
                        >
                            <svg v-if="!isGenerating" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                            </svg>
                            <svg v-else class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        </button>
                    </div>
                </div>
             </div>
         </template>

         <!-- AUDIO / TTS MODE -->
         <template v-else-if="currentModelType === 'audio'">
             <div class="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div class="max-w-3xl mx-auto space-y-8">
                    
                    <!-- Input Section -->
                    <div class="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 shadow-xl">
                        <h2 class="text-xl font-semibold text-slate-100 mb-4 flex items-center gap-2">
                             <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                            Text to Speech
                        </h2>
                        
                        <textarea 
                            v-model="ttsInput"
                            placeholder="Enter text you want to synthesize..."
                            class="w-full h-32 bg-slate-900/50 border border-slate-700 rounded-xl p-4 text-slate-200 placeholder:text-slate-600 focus:ring-2 focus:ring-purple-500/50 outline-none resize-none text-lg mb-4"
                        ></textarea>
                        
                        <div class="flex justify-end">
                             <button 
                                @click="generateAudio"
                                :disabled="!ttsInput.trim() || isGenerating"
                                class="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-medium shadow-lg shadow-purple-900/20 transition-all flex items-center gap-2"
                            >
                                <span v-if="isGenerating">Synthesizing...</span>
                                <span v-else>Generate Audio</span>
                                <svg v-if="isGenerating" class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            </button>
                        </div>
                    </div>

                    <!-- History / Results -->
                    <div v-if="audioResults.length > 0" class="space-y-4">
                        <h3 class="text-sm font-bold text-slate-400 uppercase tracking-wider">Recent Generations</h3>
                        
                        <div v-for="(result, idx) in audioResults" :key="idx" class="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center gap-4 animate-in fade-in slide-in-from-top-4">
                             <div class="h-10 w-10 rounded-full bg-purple-900/30 flex items-center justify-center text-purple-400 shrink-0">
                                 <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.414z" clip-rule="evenodd" />
                                 </svg>
                             </div>
                             <div class="flex-1 min-w-0">
                                 <p class="text-sm text-slate-200 truncate mb-1">"{{ result.text }}"</p>
                                 <div class="text-xs text-slate-500 flex gap-2">
                                     <span>{{ result.metadata?.voice }}</span>
                                     <span>•</span>
                                     <span>{{ result.metadata?.duration }}s</span>
                                 </div>
                             </div>
                             <audio controls :src="result.audioUrl" class="h-8 w-48"></audio>
                        </div>
                    </div>

                </div>
             </div>
         </template>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, watch, reactive, computed } from 'vue';
import axios from 'axios';
import Header from '../components/Header.vue';

const input = ref('');
const ttsInput = ref('');
const messages = ref([]);
const audioResults = ref([]);
const models = ref([]);
// const voices = ref([]); // Removed ref
const selectedModel = ref('');
const isGenerating = ref(false);
const loadingModels = ref(true);
const chatContainer = ref(null);

// Sidebar Params
const params = reactive({
    temperature: 0.7,
    topP: 0.95,
    maxTokens: undefined,
    stream: true,
    thinking: {
        enabled: false,
        budget: 4096,
        includeThoughts: false
    }
});

const audioParams = reactive({
    languageId: 'ru',
    voiceSample: undefined, // undefined = default
    exaggeration: 0.5,
    cfg: 0.5
});

const currentModelType = computed(() => {
    const m = models.value.find(x => x.id === selectedModel.value);
    return m ? (m.type || 'text') : 'text';
});

// Voices are now derived from the selected model's additions
const voices = computed(() => {
    const m = models.value.find(x => x.id === selectedModel.value);
    return m?.additions?.voices || [];
});

const scrollToBottom = async () => {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
};

watch(messages, () => scrollToBottom(), { deep: true });

// Fetch models
const init = async () => {
    try {
        const res = await axios.get('/available-models');
        
        models.value = res.data.models;
        // voices.value = vRes.data.voices || []; // Removed

        if (models.value.length > 0) {
           // Default selection logic could be smarter (e.g. remember last used)
           if (!selectedModel.value) selectedModel.value = models.value[0].id;
        }
    } catch (err) {
        console.error('Init failed', err);
    } finally {
        loadingModels.value = false;
    }
};

const sendMessage = async () => {
  if (!input.value.trim() || isGenerating.value) return;

  const userText = input.value;
  input.value = '';
  
  messages.value.push({ role: 'user', content: userText });
  isGenerating.value = true;

  try {
    const payload = {
        model: selectedModel.value,
        messages: messages.value.map(m => ({ role: m.role, content: m.content })),
        stream: params.stream,
        temperature: params.temperature,
        topP: params.topP,
        maxTokens: params.maxTokens || undefined
    };

    if (params.thinking.enabled) {
        payload.thinking = {
            budget: params.thinking.budget,
            includeThoughts: params.thinking.includeThoughts
        };
    }

    if (params.stream) {
        const response = await fetch('/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        messages.value.push({ role: 'assistant', content: '', isError: false });
        const lastIdx = messages.value.length - 1;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6).trim();
                    if (dataStr === '[DONE]') break;
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.error) {
                             messages.value[lastIdx].content += `\n[Error: ${data.error}]`;
                             messages.value[lastIdx].isError = true;
                        } else if (data.content) {
                            messages.value[lastIdx].content += data.content;
                        }
                    } catch (e) { }
                }
            }
        }
    } else {
        const res = await axios.post('/run', payload);
        messages.value.push({ role: 'assistant', content: res.data.content });
    }

  } catch (err) {
    messages.value.push({ role: 'assistant', content: `Error: ${err.message}`, isError: true });
  } finally {
    isGenerating.value = false;
  }
};

const generateAudio = async () => {
    if (!ttsInput.value.trim() || isGenerating.value) return;
    
    isGenerating.value = true;
    
    try {
        const payload = {
            model: selectedModel.value,
            prompt: ttsInput.value,
            // We pass audio params under 'tts' object
            tts: {
                languageId: audioParams.languageId,
                voiceSample: audioParams.voiceSample,
                exaggeration: audioParams.exaggeration,
                cfg: audioParams.cfg
            },
            stream: false // Audio is not streamed yet
        };

        const res = await axios.post('/run', payload);
        
        if (res.data.type === 'audio') {
            audioResults.value.unshift({
                text: ttsInput.value,
                audioUrl: res.data.audioUrl,
                metadata: res.data.metadata
            });
        } else {
            throw new Error('Unexpected response type from audio model');
        }
    } catch (e) {
        console.error('TTS Failed', e);
        alert('TTS Failed: ' + (e.response?.data?.error || e.message));
    } finally {
        isGenerating.value = false;
    }
};

onMounted(init);
</script>

<style>
/* Custom Toggle Checkbox */
.toggle-checkbox:checked {
  right: 0;
  border-color: #2563EB;
}
.toggle-checkbox:checked + .toggle-label {
  background-color: #2563EB;
}
.toggle-checkbox {
    right: 20px; 
    transition: all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1);
}
.toggle-checkbox:checked {
    right: 0;
}
</style>
