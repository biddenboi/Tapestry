import './Shop.css';
import { useState, useEffect, useContext } from 'react'
import { AppContext } from '../../App.jsx';

function Shop() {
   const [currentPlayer, setCurrentPlayer] = useState({});
   
   const databaseConnection = useContext(AppContext).databaseConnection;


   useEffect(() => {
      async function getCurrentPlayer() {
         
         const player = await databaseConnection.getCurrentPlayer();
         setCurrentPlayer(player);
      }

      getCurrentPlayer();
   })
   
   return <div className="shop">
      <div className="tool-bar">
         <p>Tool Bar</p>
         <div>
            <span>{currentPlayer ? currentPlayer.tokens : 0} Tokens</span>
            <button>Add Shop Item</button>
         </div>
      </div>
      {ShopRow({title: "events", items: {}})}
      {ShopRow({title: "normal", items: {}})}
      {ShopRow({title: "break", items: {}})}
      {ShopRow({title: "test", items: {}})}
      {ShopRow({title: "test", items: {}})}
      {ShopRow({title: "test", items: {}})}
   </div>
}

function ShopRow({title, items}) {
   return <div className="shop-row">
      <span>{title}</span>
      <hr />
      <div className="shop-item-scroll">
      </div>
   </div>
}

function ShopItem({item}) {

}

function ItemInfoPopup() {

}

export default Shop;