FROM php:8.3-cli-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip libicu-dev libzip-dev libpng-dev libjpeg62-turbo-dev libwebp-dev libfreetype6-dev libpq-dev \
    && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \
    && docker-php-ext-install pdo_pgsql pdo_mysql intl zip opcache bcmath gd \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# อัปโหลดใบแจ้งงาน: รูป ≤ 4 x 1MB + อะไหล่ ≤ 10 x 1MB + เอกสาร ≤ 5 x 5MB
RUN printf "upload_max_filesize=10M\npost_max_size=48M\nmax_file_uploads=30\nmemory_limit=256M\n" > /usr/local/etc/php/conf.d/uploads.ini

ENV COMPOSER_ALLOW_SUPERUSER=1 \
    PHP_CLI_SERVER_WORKERS=4

WORKDIR /var/www/html
EXPOSE 8000

# สำหรับ development — production ควรใช้ php-fpm + nginx หรือ Laravel Octane
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000", "--no-reload"]
