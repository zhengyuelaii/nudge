import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import './index.css';
// vue-sonner v2 的样式表不会自动加载（package.json 无 style 字段），需手动导入，
// 否则 Toaster 缺少定位/动画/容器样式
import 'vue-sonner/style.css';

const app = createApp(App);
app.use(router);
app.mount('#app');
