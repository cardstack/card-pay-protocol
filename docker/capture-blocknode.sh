docker exec -i foreign-node sh -c "zip -r /usr/src/app/foreign_node.zip -j /ganache_data"
docker cp foreign-node:/usr/src/app/foreign_node.zip ./foreign_node.zip
docker exec -i home-node sh -c "rm /usr/src/app/foreign_node.zip"

docker exec -i home-node sh -c "zip -r /usr/src/app/home_node.zip -j /ganache_data"
docker cp home-node:/usr/src/app/home_node.zip ./home_node.zip
docker exec -i home-node sh -c "rm /usr/src/app/home_node.zip"