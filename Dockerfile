FROM adam3am/jad-bot:latest

RUN apk add -U gettext
RUN apk add -U tzdata
ENV key=$key
ENV messages_key=$messages_key
ENV url=$url
ENV spaces=$spaces
ENV else=$else
ENV time=$time
ENV quota=$quota
ENV fungsi=$fungsi
ENV poli_id=$poli_id
ENV user_nm=$user_nm
RUN cp /usr/share/zoneinfo/Asia/Jakarta /etc/localtime
WORKDIR /usr

COPY jadwal.yml .

CMD envsubst < "jadwal.yml" > "jad-bot.yml" | monika -c jad-bot.yml --status-notification false
