# Use an official Python runtime as a parent image (change 'buster' to 'slim', if needed)
FROM python:3.11-buster  


WORKDIR /usr/src/app  

COPY requirements.txt ./  
RUN pip install --no-cache-dir -r requirements.txt  
COPY . .  

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

