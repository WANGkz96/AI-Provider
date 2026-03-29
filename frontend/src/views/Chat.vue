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
                  <div v-if="supportsThinkingLevel">
                    <label class="text-xs text-slate-400 font-medium block mb-1.5">Thinking Level</label>
                    <select v-model="params.thinking.level" class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs focus:border-blue-500 outline-none transition-colors">
                      <option value="MINIMAL">MINIMAL</option>
                      <option value="LOW">LOW</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="HIGH">HIGH</option>
                    </select>
                  </div>
                  <div v-else>
                    <label class="text-xs text-slate-400 font-medium block mb-1.5">Budget (tokens)</label>
                    <input type="number" v-model="params.thinking.budget" step="1024" min="-1" class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs focus:border-blue-500 outline-none transition-colors">
                  </div>
                  <div class="flex items-center justify-between">
                     <label class="text-xs text-slate-400 font-medium">Include Thoughts</label>
                     <input type="checkbox" v-model="params.thinking.includeThoughts" class="accent-blue-500 w-4 h-4 rounded border-slate-600 bg-slate-700">
                  </div>
                  <p class="text-[10px] leading-4 text-slate-500">
                    Gemini thought summaries are best-effort. When available, thoughts and answer stream separately and the final provider state is preserved for the next turn.
                  </p>
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
                  class="w-full accent-blue-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
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

        <!-- IMAGE MODE SETTINGS -->
        <template v-else-if="currentModelType === 'image'">
             <div class="space-y-6">
                <div>
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Image Mode</label>
                   <div class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs text-slate-200">
                      {{ imageModeLabel }}
                   </div>
                </div>

                <div>
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Image Size</label>
                   <select v-model="imageParams.size" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                      <option value="1K">1K</option>
                      <option value="2K">2K</option>
                   </select>
                </div>

                <div v-if="currentImageMode === 'imagen' || currentImageMode === 'nano-banana'">
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Aspect Ratio</label>
                   <select v-model="imageParams.aspectRatio" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                      <option value="1:1">1:1</option>
                      <option value="4:3">4:3</option>
                      <option value="3:4">3:4</option>
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                   </select>
                </div>

                <div v-if="currentImageMode === 'imagen'">
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Output Format</label>
                   <select v-model="imageParams.format" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                      <option value="image/png">PNG</option>
                      <option value="image/jpeg">JPEG</option>
                   </select>
                </div>

                <div v-if="currentImageMode === 'imagen'">
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Images Count</label>
                   <select v-model.number="imageParams.count" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                      <option v-for="n in 4" :key="n" :value="n">{{ n }}</option>
                   </select>
                </div>
             </div>
        </template>

        <!-- VIDEO MODE SETTINGS -->
        <template v-else-if="currentModelType === 'video'">
             <div class="space-y-6">
                <div>
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Video Mode</label>
                   <div class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs text-slate-200">
                      {{ videoModeLabel }}
                   </div>
                </div>

                <div>
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Aspect Ratio</label>
                   <select v-model="videoParams.aspectRatio" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                      <option value="1:1">1:1</option>
                      <option value="4:3">4:3</option>
                      <option value="3:4">3:4</option>
                   </select>
                </div>

                <div>
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Resolution</label>
                   <select v-model="videoParams.resolution" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                   </select>
                </div>

                <div>
                    <label class="text-xs font-medium text-slate-400 block mb-1.5">Duration (seconds)</label>
                    <input 
                      type="number"
                      min="1"
                      step="1"
                      v-model.number="videoParams.durationSeconds"
                      class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none"
                    >
                </div>

                <div>
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Videos Count</label>
                   <select v-model.number="videoParams.count" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                      <option v-for="n in 2" :key="n" :value="n">{{ n }}</option>
                   </select>
                </div>
             </div>
        </template>

        <!-- AUDIO MODE SETTINGS -->
        <template v-else-if="currentModelType === 'audio'">
             <div class="space-y-6">
                <div>
                   <label class="text-xs font-medium text-slate-400 block mb-1.5">Audio Mode</label>
                   <div class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs text-slate-200">
                      {{ audioModeLabel }}
                   </div>
                </div>

                <template v-if="currentAudioMode === 'gemini-tts'">
                    <div>
                       <label class="text-xs font-medium text-slate-400 block mb-1.5">Speaker Mode</label>
                       <select v-model="audioParams.geminiMode" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                          <option value="single">Single Speaker</option>
                          <option value="multi">Multi Speaker (2)</option>
                       </select>
                    </div>

                    <div v-if="audioParams.geminiMode === 'single'">
                        <label class="text-xs font-medium text-slate-400 block mb-1.5">Voice</label>
                        <select v-model="audioParams.voiceName" class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                           <option v-for="voice in voices" :key="`gemini-single-${voice.name}`" :value="voice.name">{{ voice.name }}</option>
                        </select>
                    </div>

                    <div v-else class="space-y-4">
                        <div class="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                            <label class="text-xs font-medium text-slate-400 block mb-1.5">Speaker 1 Name</label>
                            <input
                                v-model="audioParams.speaker1Name"
                                type="text"
                                class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none"
                            >
                            <label class="text-xs font-medium text-slate-400 block mt-3 mb-1.5">Speaker 1 Voice</label>
                            <select v-model="audioParams.speaker1VoiceName" class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                                <option v-for="voice in voices" :key="`gemini-s1-${voice.name}`" :value="voice.name">{{ voice.name }}</option>
                            </select>
                        </div>

                        <div class="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                            <label class="text-xs font-medium text-slate-400 block mb-1.5">Speaker 2 Name</label>
                            <input
                                v-model="audioParams.speaker2Name"
                                type="text"
                                class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none"
                            >
                            <label class="text-xs font-medium text-slate-400 block mt-3 mb-1.5">Speaker 2 Voice</label>
                            <select v-model="audioParams.speaker2VoiceName" class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-xs focus:border-blue-500 outline-none">
                                <option v-for="voice in voices" :key="`gemini-s2-${voice.name}`" :value="voice.name">{{ voice.name }}</option>
                            </select>
                        </div>
                    </div>
                </template>

                <template v-else>
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
                </template>
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
                    <div v-if="msg.role === 'user' && Array.isArray(msg.attachments) && msg.attachments.length > 0" class="mb-2 flex flex-wrap gap-2">
                        <span
                            v-for="(attachment, attachmentIndex) in msg.attachments"
                            :key="`${index}-att-${attachmentIndex}`"
                            class="inline-flex items-center gap-1 rounded-md border border-blue-400/40 bg-blue-500/20 px-2 py-1 text-[11px] font-medium text-blue-100"
                        >
                            <span>{{ attachment.kind === 'video' ? 'Video' : (attachment.kind === 'audio' ? 'Audio' : 'Image') }}</span>
                            <span class="text-blue-200/70">-</span>
                            <span class="truncate max-w-[220px]">{{ attachment.name }}</span>
                        </span>
                    </div>
                    <div
                        v-if="msg.role === 'assistant' && ((typeof msg.thoughtText === 'string' && msg.thoughtText.length > 0) || (Array.isArray(msg.thoughts) && msg.thoughts.length > 0))"
                        class="mb-3 rounded-xl border border-blue-500/20 bg-slate-900/70 px-4 py-3"
                    >
                        <div class="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-300/70">&lt;thought&gt;</div>
                        <div class="whitespace-pre-wrap text-xs leading-6 text-slate-400">{{ (typeof msg.thoughtText === 'string' && msg.thoughtText.length > 0) ? msg.thoughtText : msg.thoughts.join('\n\n') }}</div>
                    </div>
                    <div class="whitespace-pre-wrap font-light tracking-wide">{{ msg.content }}</div>
                    </div>
                </div>
             </div>

             <!-- Input Area -->
             <div class="p-4 bg-slate-900 border-t border-slate-800/50 absolute bottom-0 left-0 right-0 z-10 backdrop-blur-md bg-opacity-95">
                <div class="max-w-4xl mx-auto relative group">
                    <input
                        ref="mediaPicker"
                        type="file"
                        accept="image/*,video/*,audio/*"
                        multiple
                        class="hidden"
                        @change="onMediaFilesSelected"
                    >
                    <div v-if="attachedMedia.length > 0" class="mb-2 flex flex-wrap gap-2">
                        <span
                            v-for="(file, fileIndex) in attachedMedia"
                            :key="file.id"
                            class="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200"
                        >
                            <span>{{ file.kind === 'video' ? 'Video' : (file.kind === 'audio' ? 'Audio' : 'Image') }}</span>
                            <span class="text-slate-500">-</span>
                            <span class="truncate max-w-[200px]">{{ file.name }}</span>
                            <button
                                @click="removeAttachedMedia(fileIndex)"
                                type="button"
                                class="ml-1 text-slate-400 hover:text-slate-200"
                                :disabled="isGenerating"
                            >
                                x
                            </button>
                        </span>
                    </div>
                    <textarea
                        v-model="input"
                        @keydown="handleTextareaKeydown"
                        placeholder="Type your message..."
                        class="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 pr-32 text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none resize-none min-h-[60px] max-h-[200px] shadow-lg transition-all text-slate-200 placeholder:text-slate-600"
                        :disabled="isGenerating"
                    ></textarea>
                    
                    <div class="absolute bottom-3 right-3 flex items-center gap-2">
                        <button
                            @click="openMediaPicker"
                            type="button"
                            :disabled="isGenerating || !supportsTextMedia || attachedMedia.length >= MAX_MEDIA_ATTACHMENTS"
                            class="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 p-2 rounded-lg transition-all shadow-md flex items-center justify-center"
                            :title="supportsTextMedia ? 'Attach media files' : 'Attachments are available only for Gemini text models'"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V7.414a2 2 0 00-.586-1.414l-3.414-3.414A2 2 0 0012.586 2H4zm8 1.414V7a1 1 0 001 1h2.586L12 4.414zM5 12a1 1 0 011.447-.894L8 11.764l1.553-2.658a1 1 0 011.741-.02l1.638 2.73 1.361-.68A1 1 0 0116 12v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2z" clip-rule="evenodd" />
                            </svg>
                        </button>
                        <button 
                            @click="sendMessage"
                            :disabled="(!input.trim() && attachedMedia.length === 0) || isGenerating"
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

         <!-- IMAGE MODE -->
         <template v-else-if="currentModelType === 'image'">
             <template v-if="supportsNanoBananaChat">
                 <div class="flex-1 relative flex flex-col min-h-0 bg-slate-900">
                    <div ref="imageChatContainer" class="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar pb-36">
                        <div v-if="imageChatMessages.length === 0" class="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                            <div class="p-6 rounded-2xl bg-slate-800/30 border border-slate-800 shadow-xl max-w-xl text-center">
                                <p class="text-lg font-medium text-slate-300 mb-2">Nano Banana Chat</p>
                                <p class="text-sm leading-6 text-slate-500">Ask for an image, then continue the conversation. Generated images stay in the conversation state automatically.</p>
                                <p class="mt-4 text-xs text-slate-600">{{ imageParams.size }} / {{ imageParams.aspectRatio }}</p>
                            </div>
                        </div>

                        <div
                            v-for="(msg, index) in imageChatMessages"
                            :key="`image-chat-${index}`"
                            :class="['flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300', msg.role === 'user' ? 'justify-end' : 'justify-start']"
                        >
                            <div
                                :class="[
                                    'max-w-[88%] rounded-2xl px-5 py-4 text-sm leading-7 shadow-md break-words',
                                    msg.role === 'user'
                                        ? 'bg-emerald-600 text-white rounded-tr-none'
                                        : (msg.isError ? 'bg-red-900/40 text-red-200 border border-red-800' : 'bg-slate-800 text-slate-200 border border-slate-700/80') + ' rounded-tl-none'
                                ]"
                            >
                                <div v-if="msg.role === 'assistant' && !msg.isError && !msg.content && (!Array.isArray(msg.images) || msg.images.length === 0)" class="text-slate-400 italic">
                                    Generating image...
                                </div>

                                <div v-if="msg.role === 'user' && Array.isArray(msg.attachments) && msg.attachments.length > 0" class="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div v-for="attachment in msg.attachments" :key="attachment.id || attachment.name" class="rounded-xl border border-emerald-300/20 bg-emerald-500/10 p-2">
                                        <img :src="attachment.previewUrl" class="w-full rounded-lg border border-emerald-200/10 object-contain max-h-[240px] bg-slate-950/40" />
                                        <div class="mt-2 text-[11px] text-emerald-100/80 truncate">{{ attachment.name }}</div>
                                    </div>
                                </div>

                                <div v-if="msg.role === 'assistant' && Array.isArray(msg.images) && msg.images.length > 0" class="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div v-for="(img, imgIdx) in msg.images" :key="img.fileName + imgIdx" class="rounded-xl border border-slate-700 bg-slate-900/40 p-2">
                                        <img :src="img.dataUrl" class="w-full rounded-lg border border-slate-700/70 object-contain max-h-[320px] bg-slate-950/40" />
                                        <div class="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                                            <span>{{ img.mimeType }}</span>
                                            <a :href="img.dataUrl" :download="img.fileName" class="text-emerald-400 hover:text-emerald-300">Download</a>
                                        </div>
                                    </div>
                                </div>

                                <div v-if="msg.content" class="whitespace-pre-wrap font-light tracking-wide">{{ msg.content }}</div>
                            </div>
                        </div>
                    </div>

                    <div class="p-4 bg-slate-900 border-t border-slate-800/50 absolute bottom-0 left-0 right-0 z-10 backdrop-blur-md bg-opacity-95">
                        <div class="max-w-4xl mx-auto relative group">
                            <input
                                ref="imageChatMediaPicker"
                                type="file"
                                accept="image/*"
                                multiple
                                class="hidden"
                                @change="onImageChatFilesSelected"
                            >

                            <div v-if="imageChatAttachments.length > 0" class="mb-2 flex flex-wrap gap-2">
                                <span
                                    v-for="(file, fileIndex) in imageChatAttachments"
                                    :key="file.id"
                                    class="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200"
                                >
                                    <span>Image</span>
                                    <span class="text-slate-500">-</span>
                                    <span class="truncate max-w-[200px]">{{ file.name }}</span>
                                    <button
                                        @click="removeImageChatAttachment(fileIndex)"
                                        type="button"
                                        class="ml-1 text-slate-400 hover:text-slate-200"
                                        :disabled="isGenerating"
                                    >
                                        x
                                    </button>
                                </span>
                            </div>

                            <textarea
                                v-model="imageChatInput"
                                @keydown="handleImageChatTextareaKeydown"
                                placeholder="Describe a new image or ask to edit the previous result..."
                                class="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 pr-32 text-sm focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none resize-none min-h-[60px] max-h-[200px] shadow-lg transition-all text-slate-200 placeholder:text-slate-600"
                                :disabled="isGenerating"
                            ></textarea>

                            <div class="absolute bottom-3 right-3 flex items-center gap-2">
                                <button
                                    @click="openImageChatMediaPicker"
                                    type="button"
                                    :disabled="isGenerating || imageChatAttachments.length >= MAX_MEDIA_ATTACHMENTS"
                                    class="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 p-2 rounded-lg transition-all shadow-md flex items-center justify-center"
                                    title="Attach reference images"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V7.414a2 2 0 00-.586-1.414l-3.414-3.414A2 2 0 0012.586 2H4zm8 1.414V7a1 1 0 001 1h2.586L12 4.414zM5 12a1 1 0 011.447-.894L8 11.764l1.553-2.658a1 1 0 011.741-.02l1.638 2.73 1.361-.68A1 1 0 0116 12v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2z" clip-rule="evenodd" />
                                    </svg>
                                </button>
                                <button
                                    @click="sendNanoBananaMessage"
                                    :disabled="(!imageChatInput.trim() && imageChatAttachments.length === 0) || isGenerating"
                                    class="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white p-2 rounded-lg transition-all shadow-md flex items-center justify-center"
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
                 </div>
             </template>
             <div v-else class="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div class="max-w-4xl mx-auto space-y-8">
                    
                    <!-- Input Section -->
                    <div class="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 shadow-xl">
                        <h2 class="text-xl font-semibold text-slate-100 mb-4 flex items-center gap-2">
                             <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a2 2 0 012-2h3l2-2h4l2 2h3a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            Image Generation
                        </h2>
                        
                        <textarea 
                            v-model="imageInput"
                            placeholder="Describe the image you want to generate..."
                            class="w-full h-32 bg-slate-900/50 border border-slate-700 rounded-xl p-4 text-slate-200 placeholder:text-slate-600 focus:ring-2 focus:ring-emerald-500/50 outline-none resize-none text-lg mb-4"
                        ></textarea>
                        
                        <div class="flex items-center justify-between">
                            <div class="text-xs text-slate-500">
                                <span class="text-slate-300 font-medium">{{ imageModeLabel }}</span>
                                <span class="mx-2">/</span>
                                <span>{{ imageParams.size }}</span>
                                <span class="mx-2">/</span>
                                <span>{{ imageParams.aspectRatio }}</span>
                                <template v-if="currentImageMode === 'imagen'">
                                    <span class="mx-2">/</span>
                                    <span>{{ imageParams.format }}</span>
                                </template>
                            </div>
                            <button 
                                @click="generateImage"
                                :disabled="!imageInput.trim() || isGenerating"
                                class="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-medium shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
                            >
                                <span v-if="isGenerating">Generating...</span>
                                <span v-else>Generate Image</span>
                                <svg v-if="isGenerating" class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            </button>
                        </div>
                    </div>

                    <!-- History / Results -->
                    <div v-if="imageResults.length > 0" class="space-y-4">
                        <h3 class="text-sm font-bold text-slate-400 uppercase tracking-wider">Recent Generations</h3>
                        
                        <div v-for="(result, idx) in imageResults" :key="idx" class="bg-slate-800 border border-slate-700 rounded-xl p-4 animate-in fade-in slide-in-from-top-4">
                            <div class="flex items-start justify-between gap-4 mb-4">
                                <div class="min-w-0">
                                    <p class="text-sm text-slate-200 truncate" :title="result.prompt">"{{ result.prompt }}"</p>
                                    <div class="text-xs text-slate-500 flex gap-2">
                                        <span>{{ result.model }}</span>
                                        <span>/</span>
                                        <span>{{ result.summary }}</span>
                                    </div>
                                </div>
                                <span class="text-xs text-slate-500 shrink-0">{{ result.createdAt }}</span>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div v-for="(img, imgIdx) in result.images" :key="img.fileName + imgIdx" class="bg-slate-900/40 border border-slate-700 rounded-xl p-3">
                                    <img :src="img.dataUrl" class="w-full rounded-lg border border-slate-700/70 object-contain max-h-[360px] bg-slate-950/40" />
                                    <div class="mt-2 flex items-center justify-between text-xs text-slate-500">
                                        <span>{{ img.mimeType }}</span>
                                        <a :href="img.dataUrl" :download="img.fileName" class="text-emerald-400 hover:text-emerald-300">Download</a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
             </div>
         </template>

         <!-- VIDEO MODE -->
         <template v-else-if="currentModelType === 'video'">
             <div class="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div class="max-w-4xl mx-auto space-y-8">
                    
                    <!-- Input Section -->
                    <div class="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 shadow-xl">
                        <h2 class="text-xl font-semibold text-slate-100 mb-4 flex items-center gap-2">
                             <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 13m-6 4h8a2 2 0 002-2V9a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zM5 17a2 2 0 01-2-2V9a2 2 0 012-2h1v10H5z" />
                            </svg>
                            Video Generation
                        </h2>
                        
                        <textarea 
                            v-model="videoInput"
                            placeholder="Describe the video you want to generate..."
                            class="w-full h-32 bg-slate-900/50 border border-slate-700 rounded-xl p-4 text-slate-200 placeholder:text-slate-600 focus:ring-2 focus:ring-orange-500/50 outline-none resize-none text-lg mb-4"
                        ></textarea>
                        
                        <div class="flex items-center justify-between">
                            <div class="text-xs text-slate-500">
                                <span class="text-slate-300 font-medium">{{ videoModeLabel }}</span>
                                <span class="mx-2">/</span>
                                <span>{{ videoParams.resolution }}</span>
                                <span class="mx-2">/</span>
                                <span>{{ videoParams.aspectRatio }}</span>
                                <span class="mx-2">/</span>
                                <span>{{ videoParams.durationSeconds }}s</span>
                            </div>
                            <button 
                                @click="generateVideo"
                                :disabled="!videoInput.trim() || isGenerating"
                                class="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-medium shadow-lg shadow-orange-900/20 transition-all flex items-center gap-2"
                            >
                                <span v-if="isGenerating">Generating...</span>
                                <span v-else>Generate Video</span>
                                <svg v-if="isGenerating" class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            </button>
                        </div>
                    </div>

                    <!-- History / Results -->
                    <div v-if="videoResults.length > 0" class="space-y-4">
                        <h3 class="text-sm font-bold text-slate-400 uppercase tracking-wider">Recent Generations</h3>
                        
                        <div v-for="(result, idx) in videoResults" :key="idx" class="bg-slate-800 border border-slate-700 rounded-xl p-4 animate-in fade-in slide-in-from-top-4">
                            <div class="flex items-start justify-between gap-4 mb-4">
                                <div class="min-w-0">
                                    <p class="text-sm text-slate-200 truncate" :title="result.prompt">"{{ result.prompt }}"</p>
                                    <div class="text-xs text-slate-500 flex gap-2">
                                        <span>{{ result.model }}</span>
                                        <span>/</span>
                                        <span>{{ result.summary }}</span>
                                    </div>
                                </div>
                                <span class="text-xs text-slate-500 shrink-0">{{ result.createdAt }}</span>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div v-for="(vid, vidIdx) in result.videos" :key="vid.fileName + vidIdx" class="bg-slate-900/40 border border-slate-700 rounded-xl p-3">
                                    <video controls :src="vid.dataUrl" class="w-full rounded-lg border border-slate-700/70 bg-slate-950/40 max-h-[360px]"></video>
                                    <div class="mt-2 flex items-center justify-between text-xs text-slate-500">
                                        <span>{{ vid.mimeType }}</span>
                                        <a :href="vid.dataUrl" :download="vid.fileName" class="text-orange-400 hover:text-orange-300">Download</a>
                                    </div>
                                </div>
                            </div>
                        </div>
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
                                 <div class="text-xs text-slate-500 flex gap-2 flex-wrap">
                                     <span v-if="result.metadata?.mode">{{ result.metadata.mode }}</span>
                                     <span v-if="result.metadata?.voice">{{ result.metadata.voice }}</span>
                                     <span v-if="result.metadata?.duration !== null && result.metadata?.duration !== undefined">{{ result.metadata.duration }}s</span>
                                 </div>
                             </div>
                             <audio controls :src="result.audioUrl || result.playbackUrl" class="h-8 w-48"></audio>
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
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import Header from '../components/Header.vue';

const route = useRoute();
const router = useRouter();

const KNOWN_QUERY_KEYS = new Set([
    'model',
    'temperature',
    'topP',
    'maxTokens',
    'stream',
    'thinking',
    'thinkingLevel',
    'thinkingBudget',
    'includeThoughts',
    'imageSize',
    'imageAspectRatio',
    'imageCount',
    'imageFormat',
    'videoAspectRatio',
    'videoDurationSeconds',
    'videoResolution',
    'videoCount',
    'audioLanguageId',
    'audioVoiceSample',
    'audioExaggeration',
    'audioCfg',
    'audioTtsMode',
    'audioVoiceName',
    'audioSpeaker1Name',
    'audioSpeaker1VoiceName',
    'audioSpeaker2Name',
    'audioSpeaker2VoiceName'
]);

const DEFAULT_TEXT_PARAMS = Object.freeze({
    temperature: 0.7,
    topP: 0.95,
    maxTokens: undefined,
    stream: true,
    thinkingEnabled: false,
    thinkingLevel: 'LOW',
    thinkingBudget: 4096,
    includeThoughts: false
});

const DEFAULT_AUDIO_PARAMS = Object.freeze({
    languageId: 'ru',
    voiceSample: undefined,
    exaggeration: 0.5,
    cfg: 0.5,
    geminiMode: 'single',
    voiceName: 'Kore',
    speaker1Name: 'Speaker1',
    speaker1VoiceName: 'Kore',
    speaker2Name: 'Speaker2',
    speaker2VoiceName: 'Puck'
});

const DEFAULT_IMAGE_PARAMS = Object.freeze({
    size: '1K',
    aspectRatio: '1:1',
    count: 1,
    format: 'image/png'
});

const DEFAULT_VIDEO_PARAMS = Object.freeze({
    aspectRatio: '16:9',
    durationSeconds: 8,
    resolution: '1080p',
    count: 1
});

const IMAGE_SIZES = ['1K', '2K'];
const IMAGE_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'];
const IMAGE_FORMATS = ['image/png', 'image/jpeg'];
const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const VIDEO_RESOLUTIONS = ['720p', '1080p'];
const AUDIO_LANGUAGES = ['en', 'ru', 'es', 'fr', 'de', 'ja', 'zh'];
const GEMINI_TTS_MODES = ['single', 'multi'];
const THINKING_LEVELS = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
const MAX_MEDIA_ATTACHMENTS = 10;
const TEXT_MEDIA_ACCEPTED_PREFIXES = ['image/', 'video/', 'audio/'];

const input = ref('');
const ttsInput = ref('');
const imageInput = ref('');
const imageChatInput = ref('');
const videoInput = ref('');
const mediaPicker = ref(null);
const imageChatMediaPicker = ref(null);
const attachedMedia = ref([]);
const imageChatAttachments = ref([]);
const messages = ref([]);
const imageChatMessages = ref([]);
const audioResults = ref([]);
const imageResults = ref([]);
const videoResults = ref([]);
const models = ref([]);
const selectedModel = ref('');
const isGenerating = ref(false);
const loadingModels = ref(true);
const chatContainer = ref(null);
const imageChatContainer = ref(null);
const isApplyingQueryState = ref(false);
const isUrlSyncReady = ref(false);

// Sidebar Params
const params = reactive({
    temperature: DEFAULT_TEXT_PARAMS.temperature,
    topP: DEFAULT_TEXT_PARAMS.topP,
    maxTokens: DEFAULT_TEXT_PARAMS.maxTokens,
    stream: DEFAULT_TEXT_PARAMS.stream,
    thinking: {
        enabled: DEFAULT_TEXT_PARAMS.thinkingEnabled,
        level: DEFAULT_TEXT_PARAMS.thinkingLevel,
        budget: DEFAULT_TEXT_PARAMS.thinkingBudget,
        includeThoughts: DEFAULT_TEXT_PARAMS.includeThoughts
    }
});

const audioParams = reactive({
    languageId: DEFAULT_AUDIO_PARAMS.languageId,
    voiceSample: DEFAULT_AUDIO_PARAMS.voiceSample,
    exaggeration: DEFAULT_AUDIO_PARAMS.exaggeration,
    cfg: DEFAULT_AUDIO_PARAMS.cfg,
    geminiMode: DEFAULT_AUDIO_PARAMS.geminiMode,
    voiceName: DEFAULT_AUDIO_PARAMS.voiceName,
    speaker1Name: DEFAULT_AUDIO_PARAMS.speaker1Name,
    speaker1VoiceName: DEFAULT_AUDIO_PARAMS.speaker1VoiceName,
    speaker2Name: DEFAULT_AUDIO_PARAMS.speaker2Name,
    speaker2VoiceName: DEFAULT_AUDIO_PARAMS.speaker2VoiceName
});

const imageParams = reactive({
    size: DEFAULT_IMAGE_PARAMS.size,
    aspectRatio: DEFAULT_IMAGE_PARAMS.aspectRatio,
    count: DEFAULT_IMAGE_PARAMS.count,
    format: DEFAULT_IMAGE_PARAMS.format
});

const videoParams = reactive({
    aspectRatio: DEFAULT_VIDEO_PARAMS.aspectRatio,
    durationSeconds: DEFAULT_VIDEO_PARAMS.durationSeconds,
    resolution: DEFAULT_VIDEO_PARAMS.resolution,
    count: DEFAULT_VIDEO_PARAMS.count
});

const currentModel = computed(() => models.value.find(x => x.id === selectedModel.value));

const currentModelType = computed(() => {
    return currentModel.value ? (currentModel.value.type || 'text') : 'text';
});

const supportsTextMedia = computed(() => {
    return currentModelType.value === 'text' && currentModel.value?.provider === 'google';
});

const supportsThinkingLevel = computed(() => {
    if (currentModelType.value !== 'text' || currentModel.value?.provider !== 'google') {
        return false;
    }

    const modelId = String(currentModel.value?.apiModelId || currentModel.value?.id || '').toLowerCase();
    return /^gemini-3([.-]|$)/.test(modelId);
});

// Voices are now derived from the selected model's additions
const voices = computed(() => {
    return currentModel.value?.additions?.voices || [];
});

const currentImageMode = computed(() => {
    if (currentModelType.value !== 'image') return undefined;
    return currentModel.value?.additions?.imageMode || currentModel.value?.imageMode || 'imagen';
});

const supportsNanoBananaChat = computed(() => {
    return currentModelType.value === 'image'
        && currentImageMode.value === 'nano-banana'
        && currentModel.value?.provider === 'google';
});

const imageModeLabel = computed(() => {
    if (currentImageMode.value === 'imagen') return 'Imagen';
    if (currentImageMode.value === 'nano-banana') return 'Nano Banana';
    return currentImageMode.value || 'Image';
});

const currentVideoMode = computed(() => {
    if (currentModelType.value !== 'video') return undefined;
    return currentModel.value?.additions?.videoMode || currentModel.value?.videoMode || 'veo';
});

const videoModeLabel = computed(() => {
    if (currentVideoMode.value === 'veo') return 'Veo';
    return currentVideoMode.value || 'Video';
});

const currentAudioMode = computed(() => {
    if (currentModelType.value !== 'audio') return undefined;
    return currentModel.value?.additions?.audioMode || currentModel.value?.audioMode || (currentModel.value?.provider === 'google' ? 'gemini-tts' : 'chatterbox');
});

const audioModeLabel = computed(() => {
    if (currentAudioMode.value === 'gemini-tts') return 'Gemini 2.5 TTS';
    if (currentAudioMode.value === 'chatterbox') return 'Chatterbox';
    return currentAudioMode.value || 'Audio';
});

const toSingleQueryValue = (value) => {
    if (Array.isArray(value)) return value[0];
    if (typeof value === 'string') return value;
    return undefined;
};

const toStringValue = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    return String(value);
};

const parseBooleanQuery = (value) => {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return undefined;
};

const parseNumberQuery = (value, min, max) => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    if (min !== undefined && parsed < min) return undefined;
    if (max !== undefined && parsed > max) return undefined;
    return parsed;
};

const parseIntegerQuery = (value, min, max) => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return undefined;
    if (min !== undefined && parsed < min) return undefined;
    if (max !== undefined && parsed > max) return undefined;
    return parsed;
};

const parseEnumQuery = (value, allowedValues) => {
    if (value === undefined) return undefined;
    return allowedValues.includes(value) ? value : undefined;
};

const getModelById = (modelId) => models.value.find((model) => model.id === modelId);

const getImageModeForModel = (model) => {
    if (!model || model.type !== 'image') return undefined;
    return model.additions?.imageMode || model.imageMode || 'imagen';
};

const getAudioModeForModel = (model) => {
    if (!model || model.type !== 'audio') return undefined;
    return model.additions?.audioMode || model.audioMode || (model.provider === 'google' ? 'gemini-tts' : 'chatterbox');
};

const getUnknownRouteQuery = (query) => {
    const unknownQuery = {};
    for (const [key, value] of Object.entries(query)) {
        if (!KNOWN_QUERY_KEYS.has(key)) {
            unknownQuery[key] = value;
        }
    }
    return unknownQuery;
};

const hasKnownQueryDiff = (nextKnownQuery, currentQuery) => {
    for (const key of KNOWN_QUERY_KEYS) {
        const currentValue = toSingleQueryValue(currentQuery[key]);
        const nextValue = nextKnownQuery[key];
        if ((currentValue ?? undefined) !== (nextValue ?? undefined)) {
            return true;
        }
    }
    return false;
};

const applyQueryToState = (query) => {
    if (!models.value.length) return;

    isApplyingQueryState.value = true;

    try {
        const requestedModelId = toSingleQueryValue(query.model);
        const requestedModel = requestedModelId ? getModelById(requestedModelId) : undefined;
        const existingModel = getModelById(selectedModel.value);
        const safeModel = requestedModel || existingModel || models.value[0];

        if (safeModel && selectedModel.value !== safeModel.id) {
            selectedModel.value = safeModel.id;
        }

        params.temperature = parseNumberQuery(toSingleQueryValue(query.temperature), 0, 2) ?? DEFAULT_TEXT_PARAMS.temperature;
        params.topP = parseNumberQuery(toSingleQueryValue(query.topP), 0, 1) ?? DEFAULT_TEXT_PARAMS.topP;
        params.maxTokens = parseIntegerQuery(toSingleQueryValue(query.maxTokens), 1);
        params.stream = parseBooleanQuery(toSingleQueryValue(query.stream)) ?? DEFAULT_TEXT_PARAMS.stream;
        params.thinking.enabled = parseBooleanQuery(toSingleQueryValue(query.thinking)) ?? DEFAULT_TEXT_PARAMS.thinkingEnabled;
        params.thinking.level = parseEnumQuery(toSingleQueryValue(query.thinkingLevel), THINKING_LEVELS) ?? DEFAULT_TEXT_PARAMS.thinkingLevel;
        params.thinking.budget = parseIntegerQuery(toSingleQueryValue(query.thinkingBudget), -1) ?? DEFAULT_TEXT_PARAMS.thinkingBudget;
        params.thinking.includeThoughts = parseBooleanQuery(toSingleQueryValue(query.includeThoughts)) ?? DEFAULT_TEXT_PARAMS.includeThoughts;

        imageParams.size = parseEnumQuery(toSingleQueryValue(query.imageSize), IMAGE_SIZES) ?? DEFAULT_IMAGE_PARAMS.size;
        imageParams.aspectRatio = parseEnumQuery(toSingleQueryValue(query.imageAspectRatio), IMAGE_ASPECT_RATIOS) ?? DEFAULT_IMAGE_PARAMS.aspectRatio;

        const selectedImageMode = getImageModeForModel(safeModel);
        if (selectedImageMode === 'nano-banana') {
            imageParams.count = DEFAULT_IMAGE_PARAMS.count;
            imageParams.format = DEFAULT_IMAGE_PARAMS.format;
        } else {
            imageParams.count = parseIntegerQuery(toSingleQueryValue(query.imageCount), 1, 4) ?? DEFAULT_IMAGE_PARAMS.count;
            imageParams.format = parseEnumQuery(toSingleQueryValue(query.imageFormat), IMAGE_FORMATS) ?? DEFAULT_IMAGE_PARAMS.format;
        }

        videoParams.aspectRatio = parseEnumQuery(toSingleQueryValue(query.videoAspectRatio), VIDEO_ASPECT_RATIOS) ?? DEFAULT_VIDEO_PARAMS.aspectRatio;
        videoParams.durationSeconds = parseIntegerQuery(toSingleQueryValue(query.videoDurationSeconds), 1) ?? DEFAULT_VIDEO_PARAMS.durationSeconds;
        videoParams.resolution = parseEnumQuery(toSingleQueryValue(query.videoResolution), VIDEO_RESOLUTIONS) ?? DEFAULT_VIDEO_PARAMS.resolution;
        videoParams.count = parseIntegerQuery(toSingleQueryValue(query.videoCount), 1, 2) ?? DEFAULT_VIDEO_PARAMS.count;

        const selectedAudioMode = getAudioModeForModel(safeModel);
        const availableVoiceNames = safeModel?.type === 'audio'
            ? (safeModel.additions?.voices || []).map((voice) => voice?.name).filter(Boolean)
            : [];
        const defaultVoiceName = availableVoiceNames[0] || DEFAULT_AUDIO_PARAMS.voiceName;

        audioParams.languageId = parseEnumQuery(toSingleQueryValue(query.audioLanguageId), AUDIO_LANGUAGES) ?? DEFAULT_AUDIO_PARAMS.languageId;
        audioParams.exaggeration = parseNumberQuery(toSingleQueryValue(query.audioExaggeration), 0, 2) ?? DEFAULT_AUDIO_PARAMS.exaggeration;
        audioParams.cfg = parseNumberQuery(toSingleQueryValue(query.audioCfg), 0, 2) ?? DEFAULT_AUDIO_PARAMS.cfg;
        audioParams.geminiMode = parseEnumQuery(toSingleQueryValue(query.audioTtsMode), GEMINI_TTS_MODES) ?? DEFAULT_AUDIO_PARAMS.geminiMode;
        audioParams.speaker1Name = toSingleQueryValue(query.audioSpeaker1Name) || DEFAULT_AUDIO_PARAMS.speaker1Name;
        audioParams.speaker2Name = toSingleQueryValue(query.audioSpeaker2Name) || DEFAULT_AUDIO_PARAMS.speaker2Name;

        const requestedVoiceSample = toSingleQueryValue(query.audioVoiceSample);
        if (requestedVoiceSample && availableVoiceNames.includes(requestedVoiceSample)) {
            audioParams.voiceSample = requestedVoiceSample;
        } else {
            audioParams.voiceSample = DEFAULT_AUDIO_PARAMS.voiceSample;
        }

        const requestedVoiceName = toSingleQueryValue(query.audioVoiceName);
        if (requestedVoiceName && availableVoiceNames.includes(requestedVoiceName)) {
            audioParams.voiceName = requestedVoiceName;
        } else {
            audioParams.voiceName = defaultVoiceName;
        }

        const requestedSpeaker1Voice = toSingleQueryValue(query.audioSpeaker1VoiceName);
        const requestedSpeaker2Voice = toSingleQueryValue(query.audioSpeaker2VoiceName);
        audioParams.speaker1VoiceName = (requestedSpeaker1Voice && availableVoiceNames.includes(requestedSpeaker1Voice))
            ? requestedSpeaker1Voice
            : defaultVoiceName;
        audioParams.speaker2VoiceName = (requestedSpeaker2Voice && availableVoiceNames.includes(requestedSpeaker2Voice))
            ? requestedSpeaker2Voice
            : (availableVoiceNames[1] || defaultVoiceName);

        if (selectedAudioMode !== 'gemini-tts') {
            audioParams.geminiMode = DEFAULT_AUDIO_PARAMS.geminiMode;
            audioParams.voiceName = defaultVoiceName;
        }
    } finally {
        isApplyingQueryState.value = false;
    }
};

const buildStateQuery = () => {
    const safeTemperature = parseNumberQuery(toStringValue(params.temperature), 0, 2) ?? DEFAULT_TEXT_PARAMS.temperature;
    const safeTopP = parseNumberQuery(toStringValue(params.topP), 0, 1) ?? DEFAULT_TEXT_PARAMS.topP;
    const safeMaxTokens = parseIntegerQuery(toStringValue(params.maxTokens), 1);
    const safeThinkingLevel = parseEnumQuery(toStringValue(params.thinking.level), THINKING_LEVELS) ?? DEFAULT_TEXT_PARAMS.thinkingLevel;
    const safeThinkingBudget = parseIntegerQuery(toStringValue(params.thinking.budget), -1) ?? DEFAULT_TEXT_PARAMS.thinkingBudget;

    const safeImageSize = parseEnumQuery(toStringValue(imageParams.size), IMAGE_SIZES) ?? DEFAULT_IMAGE_PARAMS.size;
    const safeImageAspectRatio = parseEnumQuery(toStringValue(imageParams.aspectRatio), IMAGE_ASPECT_RATIOS) ?? DEFAULT_IMAGE_PARAMS.aspectRatio;
    const safeImageCount = parseIntegerQuery(toStringValue(imageParams.count), 1, 4) ?? DEFAULT_IMAGE_PARAMS.count;
    const safeImageFormat = parseEnumQuery(toStringValue(imageParams.format), IMAGE_FORMATS) ?? DEFAULT_IMAGE_PARAMS.format;

    const safeVideoAspectRatio = parseEnumQuery(toStringValue(videoParams.aspectRatio), VIDEO_ASPECT_RATIOS) ?? DEFAULT_VIDEO_PARAMS.aspectRatio;
    const safeVideoDuration = parseIntegerQuery(toStringValue(videoParams.durationSeconds), 1) ?? DEFAULT_VIDEO_PARAMS.durationSeconds;
    const safeVideoResolution = parseEnumQuery(toStringValue(videoParams.resolution), VIDEO_RESOLUTIONS) ?? DEFAULT_VIDEO_PARAMS.resolution;
    const safeVideoCount = parseIntegerQuery(toStringValue(videoParams.count), 1, 2) ?? DEFAULT_VIDEO_PARAMS.count;

    const safeAudioLanguage = parseEnumQuery(toStringValue(audioParams.languageId), AUDIO_LANGUAGES) ?? DEFAULT_AUDIO_PARAMS.languageId;
    const safeAudioExaggeration = parseNumberQuery(toStringValue(audioParams.exaggeration), 0, 2) ?? DEFAULT_AUDIO_PARAMS.exaggeration;
    const safeAudioCfg = parseNumberQuery(toStringValue(audioParams.cfg), 0, 2) ?? DEFAULT_AUDIO_PARAMS.cfg;
    const safeAudioTtsMode = parseEnumQuery(toStringValue(audioParams.geminiMode), GEMINI_TTS_MODES) ?? DEFAULT_AUDIO_PARAMS.geminiMode;
    const safeAudioSpeaker1Name = toStringValue(audioParams.speaker1Name) ?? DEFAULT_AUDIO_PARAMS.speaker1Name;
    const safeAudioSpeaker2Name = toStringValue(audioParams.speaker2Name) ?? DEFAULT_AUDIO_PARAMS.speaker2Name;
    const safeAudioVoiceName = toStringValue(audioParams.voiceName) ?? DEFAULT_AUDIO_PARAMS.voiceName;
    const safeAudioSpeaker1VoiceName = toStringValue(audioParams.speaker1VoiceName) ?? DEFAULT_AUDIO_PARAMS.speaker1VoiceName;
    const safeAudioSpeaker2VoiceName = toStringValue(audioParams.speaker2VoiceName) ?? DEFAULT_AUDIO_PARAMS.speaker2VoiceName;

    const query = {
        model: selectedModel.value || undefined,
        temperature: String(safeTemperature),
        topP: String(safeTopP),
        stream: String(Boolean(params.stream)),
        thinking: String(Boolean(params.thinking.enabled)),
        includeThoughts: String(Boolean(params.thinking.includeThoughts)),
        imageSize: safeImageSize,
        imageAspectRatio: safeImageAspectRatio,
        videoAspectRatio: safeVideoAspectRatio,
        videoDurationSeconds: String(safeVideoDuration),
        videoResolution: safeVideoResolution,
        videoCount: String(safeVideoCount),
        audioLanguageId: safeAudioLanguage,
        audioExaggeration: String(safeAudioExaggeration),
        audioCfg: String(safeAudioCfg),
        audioTtsMode: safeAudioTtsMode,
        audioSpeaker1Name: safeAudioSpeaker1Name,
        audioSpeaker1VoiceName: safeAudioSpeaker1VoiceName,
        audioSpeaker2Name: safeAudioSpeaker2Name,
        audioSpeaker2VoiceName: safeAudioSpeaker2VoiceName,
        audioVoiceName: safeAudioVoiceName
    };

    if (safeMaxTokens !== undefined) {
        query.maxTokens = String(safeMaxTokens);
    }

    if (supportsThinkingLevel.value) {
        query.thinkingLevel = safeThinkingLevel;
    } else {
        query.thinkingBudget = String(safeThinkingBudget);
    }

    const activeImageMode = getImageModeForModel(currentModel.value);
    if (activeImageMode !== 'nano-banana') {
        query.imageCount = String(safeImageCount);
        query.imageFormat = safeImageFormat;
    }

    if (typeof audioParams.voiceSample === 'string' && audioParams.voiceSample.length > 0) {
        query.audioVoiceSample = audioParams.voiceSample;
    }

    return query;
};

const syncStateToQuery = async () => {
    if (!isUrlSyncReady.value) return;

    const nextKnownQuery = buildStateQuery();
    if (!hasKnownQueryDiff(nextKnownQuery, route.query)) return;

    const mergedQuery = {
        ...getUnknownRouteQuery(route.query),
        ...nextKnownQuery
    };

    try {
        await router.replace({ query: mergedQuery });
    } catch (error) {
        console.error('Failed to sync URL params', error);
    }
};

const scrollToBottom = async () => {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
};

const scrollImageChatToBottom = async () => {
  await nextTick();
  if (imageChatContainer.value) {
    imageChatContainer.value.scrollTop = imageChatContainer.value.scrollHeight;
  }
};

watch(messages, () => scrollToBottom(), { deep: true });
watch(imageChatMessages, () => scrollImageChatToBottom(), { deep: true });

watch(
    () => route.query,
    (query) => {
        if (!isUrlSyncReady.value || isApplyingQueryState.value) return;
        applyQueryToState(query);
    }
);

watch(
    () => [
        selectedModel.value,
        params.temperature,
        params.topP,
        params.maxTokens,
        params.stream,
        params.thinking.enabled,
        params.thinking.level,
        params.thinking.budget,
        params.thinking.includeThoughts,
        imageParams.size,
        imageParams.aspectRatio,
        imageParams.count,
        imageParams.format,
        videoParams.aspectRatio,
        videoParams.durationSeconds,
        videoParams.resolution,
        videoParams.count,
        audioParams.languageId,
        audioParams.voiceSample,
        audioParams.exaggeration,
        audioParams.cfg,
        audioParams.geminiMode,
        audioParams.voiceName,
        audioParams.speaker1Name,
        audioParams.speaker1VoiceName,
        audioParams.speaker2Name,
        audioParams.speaker2VoiceName,
        currentImageMode.value
    ],
    () => {
        if (!isUrlSyncReady.value || isApplyingQueryState.value) return;
        syncStateToQuery();
    }
);

watch(
    () => [selectedModel.value, voices.value.map((voice) => voice?.name || '').join('|')],
    () => {
        if (currentModelType.value !== 'audio') return;

        const availableVoiceNames = voices.value.map((voice) => voice?.name).filter(Boolean);
        const fallbackVoice = availableVoiceNames[0] || DEFAULT_AUDIO_PARAMS.voiceName;

        if (audioParams.voiceSample) {
            const isValidVoiceSample = availableVoiceNames.includes(audioParams.voiceSample);
            if (!isValidVoiceSample) {
                audioParams.voiceSample = DEFAULT_AUDIO_PARAMS.voiceSample;
            }
        }

        if (!availableVoiceNames.includes(audioParams.voiceName)) {
            audioParams.voiceName = fallbackVoice;
        }
        if (!availableVoiceNames.includes(audioParams.speaker1VoiceName)) {
            audioParams.speaker1VoiceName = fallbackVoice;
        }
        if (!availableVoiceNames.includes(audioParams.speaker2VoiceName)) {
            audioParams.speaker2VoiceName = availableVoiceNames[1] || fallbackVoice;
        }
    }
);

watch(
    supportsTextMedia,
    (enabled) => {
        if (!enabled && attachedMedia.value.length > 0) {
            clearAttachedMedia();
        }
    }
);

watch(
    supportsNanoBananaChat,
    (enabled) => {
        if (!enabled && imageChatAttachments.value.length > 0) {
            clearImageChatAttachments();
        }
    }
);

watch(
    currentAudioMode,
    (mode) => {
        if (mode !== 'gemini-tts') return;
        audioParams.geminiMode = parseEnumQuery(toStringValue(audioParams.geminiMode), GEMINI_TTS_MODES) ?? DEFAULT_AUDIO_PARAMS.geminiMode;
        audioParams.speaker1Name = toStringValue(audioParams.speaker1Name) ?? DEFAULT_AUDIO_PARAMS.speaker1Name;
        audioParams.speaker2Name = toStringValue(audioParams.speaker2Name) ?? DEFAULT_AUDIO_PARAMS.speaker2Name;
    }
);

// Fetch models
const init = async () => {
    try {
        const res = await axios.get('/available-models');
        
        models.value = res.data.models;

        if (models.value.length > 0) {
            applyQueryToState(route.query);

            if (!models.value.some((model) => model.id === selectedModel.value)) {
                selectedModel.value = models.value[0].id;
            }
        }
    } catch (err) {
        console.error('Init failed', err);
    } finally {
        loadingModels.value = false;
        isUrlSyncReady.value = true;
        await syncStateToQuery();
    }
};

const isSupportedTextMedia = (mimeType) => {
    if (typeof mimeType !== 'string') return false;
    const normalized = mimeType.toLowerCase();
    return TEXT_MEDIA_ACCEPTED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const openMediaPicker = () => {
    if (isGenerating.value) return;
    if (!supportsTextMedia.value) {
        alert('Media attachments are currently available only for Gemini text models.');
        return;
    }
    mediaPicker.value?.click();
};

const removeAttachedMedia = (fileIndex) => {
    attachedMedia.value.splice(fileIndex, 1);
};

const clearAttachedMedia = () => {
    attachedMedia.value = [];
    if (mediaPicker.value) {
        mediaPicker.value.value = '';
    }
};

const openImageChatMediaPicker = () => {
    if (isGenerating.value || !supportsNanoBananaChat.value) return;
    imageChatMediaPicker.value?.click();
};

const removeImageChatAttachment = (fileIndex) => {
    imageChatAttachments.value.splice(fileIndex, 1);
};

const clearImageChatAttachments = () => {
    imageChatAttachments.value = [];
    if (imageChatMediaPicker.value) {
        imageChatMediaPicker.value.value = '';
    }
};

const onImageChatFilesSelected = (event) => {
    const fileList = Array.from(event?.target?.files || []);
    if (fileList.length === 0) {
        return;
    }

    const slotsLeft = Math.max(0, MAX_MEDIA_ATTACHMENTS - imageChatAttachments.value.length);
    const accepted = [];

    for (const file of fileList.slice(0, slotsLeft)) {
        if (!file.type.toLowerCase().startsWith('image/')) {
            continue;
        }

        accepted.push({
            id: `image-chat-${Date.now()}-${accepted.length}`,
            file,
            name: file.name || `image-${accepted.length + 1}`,
            mimeType: file.type || 'image/png',
            kind: 'image'
        });
    }

    if (accepted.length === 0) {
        alert('Nano Banana chat supports image attachments only.');
    } else {
        imageChatAttachments.value.push(...accepted);
    }

    if (event?.target) {
        event.target.value = '';
    }
};

const onMediaFilesSelected = (event) => {
    const selectedFiles = Array.from(event?.target?.files || []);
    if (selectedFiles.length === 0) return;

    const slotsLeft = Math.max(0, MAX_MEDIA_ATTACHMENTS - attachedMedia.value.length);
    if (slotsLeft === 0) {
        alert(`You can attach up to ${MAX_MEDIA_ATTACHMENTS} files per request.`);
        event.target.value = '';
        return;
    }

    const accepted = [];
    const rejected = [];

    for (const file of selectedFiles) {
        if (!isSupportedTextMedia(file.type)) {
            rejected.push(file.name || 'unknown-file');
            continue;
        }

        if (accepted.length >= slotsLeft) {
            break;
        }

        const kind = file.type.startsWith('video/')
            ? 'video'
            : (file.type.startsWith('audio/') ? 'audio' : 'image');

        accepted.push({
            id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
            file,
            name: file.name,
            mimeType: file.type,
            kind
        });
    }

    if (accepted.length > 0) {
        attachedMedia.value.push(...accepted);
    }

    const skippedForLimit = selectedFiles.length - accepted.length - rejected.length;
    if (rejected.length > 0) {
        alert(`Unsupported media type skipped:\n${rejected.join('\n')}`);
    } else if (skippedForLimit > 0) {
        alert(`Only ${MAX_MEDIA_ATTACHMENTS} attachments are allowed per request.`);
    }

    event.target.value = '';
};

const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error(`Failed to read file: ${file?.name || 'unknown'}`));
    reader.readAsDataURL(file);
});

const buildMediaPayload = async (files) => {
    return Promise.all(files.map(async (entry) => ({
        type: entry.kind,
        mimeType: entry.mimeType,
        name: entry.name,
        data: await readFileAsBase64(entry.file)
    })));
};

const stripDataUrlPrefix = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    const commaIndex = trimmed.indexOf(',');
    if (trimmed.startsWith('data:') && commaIndex !== -1) {
        return trimmed.slice(commaIndex + 1);
    }

    return trimmed;
};

const extractThoughtTexts = (parts) => {
    if (!Array.isArray(parts)) {
        return [];
    }

    return parts
        .filter((part) => part?.thought === true && typeof part?.text === 'string' && part.text.length > 0)
        .map((part) => part.text);
};

const serializeChatMessageForRequest = (message) => {
    const payload = {
        role: message.role,
        content: typeof message.content === 'string' ? message.content : ''
    };

    if (Array.isArray(message.parts) && message.parts.length > 0) {
        payload.parts = message.parts;
    }

    if (message.provider_state && typeof message.provider_state === 'object') {
        payload.provider_state = message.provider_state;
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        payload.tool_calls = message.tool_calls;
    }

    if (typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0) {
        payload.tool_call_id = message.tool_call_id;
    }

    if (typeof message.name === 'string' && message.name.length > 0) {
        payload.name = message.name;
    }

    return payload;
};

const buildAssistantMessageFromRunResponse = (data) => {
    const message = data?.message && typeof data.message === 'object' ? data.message : {};
    const parts = Array.isArray(message.parts)
        ? message.parts
        : (Array.isArray(message.provider_state?.parts)
            ? message.provider_state.parts
            : (Array.isArray(data?.parts)
                ? data.parts
                : (Array.isArray(data?.provider_state?.parts) ? data.provider_state.parts : [])));
    const providerState = message.provider_state
        ?? data?.provider_state
        ?? message.providerState
        ?? data?.providerState
        ?? (parts.length > 0 ? { role: message.role || 'model', parts } : null);

    return {
        role: message.role || 'assistant',
        content: typeof data?.content === 'string'
            ? data.content
            : (typeof message.content === 'string' ? message.content : ''),
        parts,
        provider_state: providerState,
        thoughts: extractThoughtTexts(parts),
        thoughtText: '',
        tool_calls: Array.isArray(message.tool_calls)
            ? message.tool_calls
            : (Array.isArray(message.toolCalls) ? message.toolCalls : []),
        isError: false
    };
};

const normalizeReturnedImages = (images, fallbackMimeType = 'image/png') => {
    return (images || []).map((img, idx) => {
        const mimeType = img.mimeType || fallbackMimeType;
        return {
            mimeType,
            dataUrl: `data:${mimeType};base64,${img.data}`,
            fileName: `image_${Date.now()}_${idx + 1}.${mimeToExtension(mimeType)}`
        };
    });
};

const buildNanoBananaUserMessage = ({ text, mediaPayload }) => {
    const trimmedText = text.trim();
    const inlineImageParts = mediaPayload.map((item) => ({
        inlineData: {
            mimeType: item.mimeType,
            data: stripDataUrlPrefix(item.data)
        }
    }));
    const parts = [
        ...inlineImageParts,
        ...(trimmedText ? [{ text: trimmedText }] : [])
    ];

    return {
        role: 'user',
        content: trimmedText,
        parts,
        attachments: mediaPayload.map((item, index) => ({
            id: `image-chat-preview-${Date.now()}-${index}`,
            name: item.name,
            mimeType: item.mimeType,
            previewUrl: item.data
        }))
    };
};

const buildNanoBananaAssistantMessage = (data) => {
    const message = data?.message && typeof data.message === 'object' ? data.message : {};
    const parts = Array.isArray(message.parts)
        ? message.parts
        : (Array.isArray(data?.provider_state?.parts) ? data.provider_state.parts : []);
    const providerState = data?.provider_state
        ?? message.provider_state
        ?? message.providerState
        ?? (parts.length > 0 ? { role: 'model', parts } : null);

    return {
        role: 'assistant',
        content: typeof message.content === 'string'
            ? message.content
            : (typeof data?.metadata?.text === 'string' ? data.metadata.text : ''),
        images: normalizeReturnedImages(data?.images, imageParams.format || 'image/png'),
        parts,
        provider_state: providerState,
        isError: false
    };
};

const handleTextareaKeydown = (event) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;
    event.preventDefault();
    sendMessage();
};

const handleImageChatTextareaKeydown = (event) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;
    event.preventDefault();
    sendNanoBananaMessage();
};

const sendMessage = async () => {
  if ((!input.value.trim() && attachedMedia.value.length === 0) || isGenerating.value) return;
  if (attachedMedia.value.length > 0 && !supportsTextMedia.value) {
    alert('Media attachments are currently available only for Gemini text models.');
    return;
  }

  const userText = input.value;
  const pendingAttachments = attachedMedia.value.map((item) => ({
    ...item
  }));

  input.value = '';
  clearAttachedMedia();
  
  messages.value.push({
    role: 'user',
    content: userText,
    attachments: pendingAttachments.map((item) => ({
      name: item.name,
      mimeType: item.mimeType,
      kind: item.kind
    }))
  });
  isGenerating.value = true;

  try {
    const mediaPayload = await buildMediaPayload(pendingAttachments);
    const shouldStream = params.stream && mediaPayload.length === 0;

    const payload = {
        model: selectedModel.value,
        messages: messages.value
            .filter((message) => !message.isError)
            .map((message) => serializeChatMessageForRequest(message)),
        stream: shouldStream,
        temperature: params.temperature,
        topP: params.topP,
        maxTokens: params.maxTokens || undefined
    };

    if (mediaPayload.length > 0) {
        payload.media = mediaPayload;
    }

    if (params.thinking.enabled) {
        payload.thinking = {
            includeThoughts: params.thinking.includeThoughts
        };

        if (supportsThinkingLevel.value) {
            payload.thinking.level = params.thinking.level;
        } else {
            payload.thinking.budget = params.thinking.budget;
        }
    }

    if (shouldStream) {
        const response = await fetch('/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        
        messages.value.push({
            role: 'assistant',
            content: '',
            thoughts: [],
            thoughtText: '',
            parts: [],
            provider_state: null,
            isError: false
        });
        const lastIdx = messages.value.length - 1;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const frames = sseBuffer.split('\n\n');
            sseBuffer = frames.pop() || '';

            for (const frame of frames) {
                const lines = frame.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6).trim();
                        if (dataStr === '[DONE]') break;
                        try {
                            const data = JSON.parse(dataStr);
                            if (data.error) {
                                 messages.value[lastIdx].content += `\n[Error: ${data.error}]`;
                                 messages.value[lastIdx].isError = true;
                            }
                            if (data.content) {
                                messages.value[lastIdx].content += data.content;
                            }
                            if (data.thought) {
                                messages.value[lastIdx].thoughtText += data.thought;
                            }
                            if (data.provider_state) {
                                messages.value[lastIdx].provider_state = data.provider_state;
                                if (Array.isArray(data.provider_state.parts)) {
                                    messages.value[lastIdx].parts = data.provider_state.parts;
                                    messages.value[lastIdx].thoughts = extractThoughtTexts(data.provider_state.parts);
                                }
                            }
                        } catch (e) { }
                    }
                }
            }
        }
    } else {
        const res = await axios.post('/run', payload);
        messages.value.push(buildAssistantMessageFromRunResponse(res.data));
    }

  } catch (err) {
    messages.value.push({ role: 'assistant', content: `Error: ${err.message}`, isError: true });
  } finally {
    isGenerating.value = false;
  }
};

const mimeToExtension = (mimeType) => {
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/jpeg') return 'jpg';
    return 'bin';
};

const buildImageSummary = () => {
    if (currentImageMode.value === 'imagen') {
        return `${imageParams.size} / ${imageParams.aspectRatio} / ${imageParams.format} / ${imageParams.count}x`;
    }
    return `${imageParams.size} / ${imageParams.aspectRatio}`;
};

const buildVideoSummary = () => {
    return `${videoParams.resolution} / ${videoParams.aspectRatio} / ${videoParams.durationSeconds}s / ${videoParams.count}x`;
};

const sendNanoBananaMessage = async () => {
    if ((!imageChatInput.value.trim() && imageChatAttachments.value.length === 0) || isGenerating.value) return;
    if (!supportsNanoBananaChat.value) return;

    isGenerating.value = true;

    try {
        const pendingAttachments = imageChatAttachments.value.map((item) => ({ ...item }));
        const mediaPayload = await buildMediaPayload(pendingAttachments);
        const hasUnsupportedAttachment = mediaPayload.some((item) => !item.mimeType.toLowerCase().startsWith('image/'));

        if (hasUnsupportedAttachment) {
            throw new Error('Nano Banana chat supports image attachments only');
        }

        const userMessage = buildNanoBananaUserMessage({
            text: imageChatInput.value,
            mediaPayload
        });

        imageChatInput.value = '';
        clearImageChatAttachments();
        imageChatMessages.value.push(userMessage);

        const payload = {
            model: selectedModel.value,
            messages: imageChatMessages.value
                .filter((message) => !message.isError)
                .map((message) => serializeChatMessageForRequest(message)),
            image: {
                size: imageParams.size,
                aspectRatio: imageParams.aspectRatio
            },
            stream: false
        };

        const res = await axios.post('/run', payload);

        if (res.data.type !== 'image') {
            throw new Error('Unexpected response type from Nano Banana');
        }

        imageChatMessages.value.push(buildNanoBananaAssistantMessage(res.data));
    } catch (e) {
        console.error('Nano Banana chat failed', e);
        imageChatMessages.value.push({
            role: 'assistant',
            content: `Error: ${e.response?.data?.error || e.message}`,
            images: [],
            isError: true
        });
    } finally {
        isGenerating.value = false;
    }
};

const generateImage = async () => {
    if (!imageInput.value.trim() || isGenerating.value) return;

    isGenerating.value = true;

    try {
        const imagePayload = {
            size: imageParams.size
        };

        if (currentImageMode.value === 'imagen') {
            imagePayload.count = imageParams.count;
            imagePayload.aspectRatio = imageParams.aspectRatio;
            imagePayload.format = imageParams.format;
        } else {
            imagePayload.aspectRatio = imageParams.aspectRatio;
        }

        const payload = {
            model: selectedModel.value,
            prompt: imageInput.value,
            image: imagePayload,
            stream: false
        };

        const res = await axios.post('/run', payload);

        if (res.data.type === 'image') {
            const now = new Date();
            const images = (res.data.images || []).map((img, idx) => {
                const mimeType = img.mimeType || imageParams.format || 'image/png';
                return {
                    mimeType,
                    dataUrl: `data:${mimeType};base64,${img.data}`,
                    fileName: `image_${now.getTime()}_${idx + 1}.${mimeToExtension(mimeType)}`
                };
            });

            if (images.length === 0) {
                throw new Error('No images returned from API');
            }

            imageResults.value.unshift({
                prompt: imageInput.value,
                model: selectedModel.value,
                createdAt: now.toLocaleTimeString(),
                summary: buildImageSummary(),
                images
            });
        } else {
            throw new Error('Unexpected response type from image model');
        }
    } catch (e) {
        console.error('Image generation failed', e);
        alert('Image generation failed: ' + (e.response?.data?.error || e.message));
    } finally {
        isGenerating.value = false;
    }
};

const generateVideo = async () => {
    if (!videoInput.value.trim() || isGenerating.value) return;

    isGenerating.value = true;

    try {
        const payload = {
            model: selectedModel.value,
            prompt: videoInput.value,
            video: {
                aspectRatio: videoParams.aspectRatio,
                durationSeconds: videoParams.durationSeconds,
                resolution: videoParams.resolution,
                count: videoParams.count
            },
            stream: false
        };

        const res = await axios.post('/run', payload);

        if (res.data.type === 'video') {
            const now = new Date();
            const videos = (res.data.videos || []).map((vid, idx) => {
                const mimeType = vid.mimeType || 'video/mp4';
                const ext = mimeType.split('/')[1] || 'mp4';
                return {
                    mimeType,
                    dataUrl: `data:${mimeType};base64,${vid.data}`,
                    fileName: `video_${now.getTime()}_${idx + 1}.${ext}`
                };
            });

            if (videos.length === 0) {
                throw new Error('No videos returned from API');
            }

            videoResults.value.unshift({
                prompt: videoInput.value,
                model: selectedModel.value,
                createdAt: now.toLocaleTimeString(),
                summary: buildVideoSummary(),
                videos
            });
        } else {
            throw new Error('Unexpected response type from video model');
        }
    } catch (e) {
        console.error('Video generation failed', e);
        alert('Video generation failed: ' + (e.response?.data?.error || e.message));
    } finally {
        isGenerating.value = false;
    }
};

const generateAudio = async () => {
    if (!ttsInput.value.trim() || isGenerating.value) return;
    
    isGenerating.value = true;
    
    try {
        const ttsPayload = {};

        if (currentAudioMode.value === 'gemini-tts') {
            if (audioParams.geminiMode === 'multi') {
                ttsPayload.mode = 'multi';
                ttsPayload.speakers = [
                    {
                        speaker: (audioParams.speaker1Name || DEFAULT_AUDIO_PARAMS.speaker1Name).trim(),
                        voiceName: audioParams.speaker1VoiceName || audioParams.voiceName || DEFAULT_AUDIO_PARAMS.voiceName
                    },
                    {
                        speaker: (audioParams.speaker2Name || DEFAULT_AUDIO_PARAMS.speaker2Name).trim(),
                        voiceName: audioParams.speaker2VoiceName || audioParams.voiceName || DEFAULT_AUDIO_PARAMS.speaker2VoiceName
                    }
                ];
            } else {
                ttsPayload.mode = 'single';
                ttsPayload.voiceName = audioParams.voiceName || DEFAULT_AUDIO_PARAMS.voiceName;
            }
        } else {
            ttsPayload.languageId = audioParams.languageId;
            ttsPayload.voiceSample = audioParams.voiceSample;
            ttsPayload.exaggeration = audioParams.exaggeration;
            ttsPayload.cfg = audioParams.cfg;
        }

        const payload = {
            model: selectedModel.value,
            prompt: ttsInput.value,
            tts: ttsPayload,
            stream: false // Audio is not streamed yet
        };

        const res = await axios.post('/run', payload);
        
        if (res.data.type === 'audio') {
            const playbackUrl = res.data.audioUrl
                || (res.data.audio?.data ? `data:${res.data.audio.mimeType || 'audio/wav'};base64,${res.data.audio.data}` : null);

            if (!playbackUrl) {
                throw new Error('Audio response does not include playable data');
            }

            audioResults.value.unshift({
                text: ttsInput.value,
                audioUrl: res.data.audioUrl,
                playbackUrl,
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

