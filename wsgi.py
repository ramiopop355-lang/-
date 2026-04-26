import os
from django.core.wsgi import get_wsgi_application

# هنا نخبر النظام أن ملف الإعدادات موجود داخل المجلد المسمى '-'
os.environ.setdefault('DJANGO_SETTINGS_MODULE', '-.settings')

application = get_wsgi_application()
app = application
