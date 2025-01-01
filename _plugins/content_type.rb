module Jekyll
  class ContentTypeGenerator < Generator
    safe true
    priority :highest

    def generate(site)
      # Handle pages
      site.pages.each do |page|
        set_content_type(page)
      end

      # Handle static files
      site.static_files.each do |file|
        set_content_type(file)
      end
    end

    private

    def set_content_type(item)
      ext = File.extname(item.path).downcase
      content_type = case ext
        when '.html', '.htm'
          'text/html; charset=utf-8'
        when '.mp4'
          'video/mp4'
        when '.jpg', '.jpeg'
          'image/jpeg'
        when '.png'
          'image/png'
        when '.json'
          'application/json'
        else
          nil
      end

      if content_type
        item.data ||= {}
        item.data['content_type'] = content_type
      end
    end
  end
end

# Monkey patch StaticFile to support data
module Jekyll
  class StaticFile
    attr_accessor :data

    def data
      @data ||= {}
    end
  end
end 